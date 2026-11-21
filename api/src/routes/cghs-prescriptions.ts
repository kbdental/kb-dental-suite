import { Type, type Static } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { sql } from "kysely";
import type { AppOptions } from "../app.js";
import { asActor } from "../http/context.js";
import { HttpError, notFound } from "../http/errors.js";
import { dobOut, findPatient } from "../legacy/patients.js";

const Uhid = Type.String({ minLength: 1, maxLength: 100 });
const Day = Type.String({ format: "date" });
const Text = Type.String({ maxLength: 200 });
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
    const { rows } = await sql<{ date: string; uhid: string; savedAt: Date; document: Static<typeof Prescription> }>`
      SELECT prescription_date::text AS date, uhid, created_at AS "savedAt", document
      FROM cghs_prescriptions
      WHERE true
        ${uhid ? sql`AND uhid = ${uhid}` : sql``}
        ${from ? sql`AND prescription_date >= ${from}::date` : sql``}
        ${to ? sql`AND prescription_date <= ${to}::date` : sql``}
      ORDER BY prescription_date DESC, id DESC
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
};
