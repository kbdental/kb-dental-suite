import { Type, type Static } from "@sinclair/typebox";
import { createHash } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { sql } from "kysely";
import type { AppOptions } from "../app.js";
import { asActor } from "../http/context.js";
import { HttpError, notFound } from "../http/errors.js";
import { dobOut, findPatient } from "../legacy/patients.js";

const Uhid = Type.String({ minLength: 1, maxLength: 100 });
const Day = Type.String({ format: "date" });
const Text = Type.String({ maxLength: 200 });
const Id = Type.Object({ id: Type.String({ format: "uuid" }) });
const PDF_LIMIT = 8 * 1024 * 1024;
const Prescription = Type.Object({
  date: Day,
  pat: Type.Object({ uhid: Uhid, name: Text, dob: Text }, { additionalProperties: false }),
  rows: Type.Array(Type.Object({
    code: Text,
    name: Type.String({ minLength: 1, maxLength: 500 }),
    tooth: Text,
    qty: Type.Number({ exclusiveMinimum: 0 }),
    sits: Type.Array(Type.Object({
      date: Type.Union([Day, Type.Literal("")]),
      text: Type.String({ maxLength: 10000 })
    }, { additionalProperties: false }), { maxItems: 200 })
  }, { additionalProperties: false }), { minItems: 1, maxItems: 200 })
}, { additionalProperties: false });

const Search = Type.Object({
  uhid: Type.Optional(Type.String({ maxLength: 100 })),
  from: Type.Optional(Day),
  to: Type.Optional(Day),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 }))
}, { additionalProperties: false });

export const cghsPrescriptionRoutes: FastifyPluginAsyncTypebox<AppOptions> = async (app, { db }) => {
  app.addContentTypeParser("application/pdf", { parseAs: "buffer", bodyLimit: PDF_LIMIT }, (_req, body, done) => done(null, body));
  app.post("/", { schema: { body: Prescription } }, async (req, reply) => {
    const id = await asActor(db, req, "clinical:write", async tx => {
      const uhid = req.body.pat.uhid.trim().toUpperCase();
      const patient = await findPatient(tx, uhid);
      if (!patient) throw notFound("Patient");

      const document = { ...req.body, pat: { uhid: patient.uhid, name: patient.full_name, dob: dobOut(patient.dob) } };
      const saved = await sql<{ id: string }>`
        INSERT INTO cghs_prescriptions (patient_id, uhid, prescription_date, document)
        VALUES (${patient.id}, ${patient.uhid}, ${document.date}::date, ${JSON.stringify(document)}::jsonb)
        RETURNING id`.execute(tx);
      return saved.rows[0]!.id;
    });
    return reply.code(201).send({ success: true, id });
  });

  app.get("/", { schema: { querystring: Search } }, async req => asActor(db, req, "clinical:read", async tx => {
    const { from, to, limit = 50 } = req.query;
    if (from && to && from > to) throw new HttpError(400, "invalid_range", "The start date must be before or equal to the end date");
    const uhid = req.query.uhid?.trim().toUpperCase();
    const { rows } = await sql<{ id: string; date: string; uhid: string; savedAt: Date; hasSignedPdf: boolean; imported: boolean; document: Static<typeof Prescription> }>`
      SELECT p.id, prescription_date::text AS date, uhid,
        coalesce(source_saved_at, p.created_at) AS "savedAt", source_saved_at IS NOT NULL AS imported,
        f.id IS NOT NULL AS "hasSignedPdf", document
      FROM cghs_prescriptions p
      LEFT JOIN cghs_prescription_pdfs f ON f.clinic_id=p.clinic_id AND f.prescription_id=p.id
      WHERE true
        ${uhid ? sql`AND uhid = ${uhid}` : sql``}
        ${from ? sql`AND prescription_date >= ${from}::date` : sql``}
        ${to ? sql`AND prescription_date <= ${to}::date` : sql``}
      ORDER BY prescription_date DESC, coalesce(source_saved_at, p.created_at) DESC, p.id DESC
      LIMIT ${limit}`.execute(tx);

    return { success: true, prescriptions: rows.map(({ document, ...record }) => ({
      ...record,
      patientName: document.pat.name,
      treatments: document.rows.map(row => row.name).join(", "),
      teeth: document.rows.map(row => row.tooth).filter(Boolean).join(", "),
      sittings: String(document.rows.reduce((total, row) => total + row.sits.length, 0)),
      document: JSON.stringify(document)
    })) };
  }));

  app.post("/:id/signed-pdf", { bodyLimit: PDF_LIMIT, schema: { params: Id } }, async (req, reply) => {
    const status = await asActor(db, req, "clinical:write", async tx => {
      const pdf = req.body;
      if (!Buffer.isBuffer(pdf) || pdf.length < 16 || pdf.length > PDF_LIMIT ||
          !/^%PDF-[12]\.[0-9](?:\r|\n)/.test(pdf.subarray(0, 12).toString("ascii")) ||
          !/%%EOF\s*$/.test(pdf.subarray(-1024).toString("latin1"))) {
        throw new HttpError(400, "invalid_pdf", "Choose a signed PDF file up to 8 MB");
      }
      const sha256 = createHash("sha256").update(pdf).digest("hex");
      const { rows } = await sql`
        INSERT INTO cghs_prescription_pdfs (prescription_id, file_bytes, sha256)
        SELECT id, ${pdf}, ${sha256} FROM cghs_prescriptions WHERE id=${req.params.id}
        ON CONFLICT (clinic_id, prescription_id) DO NOTHING
        RETURNING id`.execute(tx);
      if (rows.length) return 201;
      const existing = (await sql<{ sha256: string }>`SELECT sha256 FROM cghs_prescription_pdfs WHERE prescription_id=${req.params.id}`.execute(tx)).rows[0];
      if (!existing) throw notFound("Prescription");
      if (existing.sha256 !== sha256) throw new HttpError(409, "pdf_already_filed", "A different signed PDF is already filed for this prescription");
      return 200;
    });
    return reply.code(status).send({ success: true });
  });

  app.get("/:id/signed-pdf", { schema: { params: Id } }, async (req, reply) => {
    const pdf = await asActor(db, req, "clinical:read", async tx => {
      const file = (await sql<{ file_bytes: Buffer }>`SELECT file_bytes FROM cghs_prescription_pdfs WHERE prescription_id=${req.params.id}`.execute(tx)).rows[0];
      if (!file) throw notFound("Signed PDF");
      return file.file_bytes;
    });
    return reply.type("application/pdf").header("Content-Disposition", 'attachment; filename="CGHS-prescription-signed.pdf"').send(pdf);
  });
};
