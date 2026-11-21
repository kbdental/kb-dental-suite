import { afterAll, beforeAll, expect, it } from "vitest";
import { makeWorld, signIn, type World } from "./setup.js";

let world: World;
beforeAll(async () => { world = await makeWorld(); });
afterAll(async () => { await world?.close(); });

const url = "/api/v1/cghs-prescriptions";

it("files a prescription under a local patient and limits searches to authorized clinic staff", async () => {
  const { app } = world;
  const cookie = await signIn(app, "alpha", "a-admin");
  const other = await signIn(app, "beta", "b-admin");
  const desk = await signIn(app, "alpha", "a-desk");
  expect((await app.inject(url)).statusCode).toBe(401);
  expect((await app.inject({ url, headers: { cookie: desk } })).statusCode).toBe(403);

  const registered = await app.inject({ method: "POST", url: "/api/v1/patients", headers: { cookie }, payload: { full_name: "Sample Patient" } });
  expect(registered.statusCode).toBe(201);
  const { patient } = registered.json();
  const prescription = {
    date: "2026-11-21",
    pat: { uhid: patient.uhid, name: "Sample Patient", dob: "" },
    rows: [{ code: "A1", name: "Examination", tooth: "16", qty: 1, sits: [{ date: "2026-11-21", text: "Review" }] }]
  };
  const save = (session: string, payload: object) => app.inject({ method: "POST", url, headers: { cookie: session }, payload });
  expect((await save(desk, prescription)).statusCode).toBe(403);
  expect((await save(other, prescription)).statusCode).toBe(404);
  expect((await save(cookie, { ...prescription, rows: [] })).statusCode).toBe(400);
  expect((await save(cookie, prescription)).statusCode).toBe(201);

  const search = (session: string, query = "") => app.inject({ url: url + query, headers: { cookie: session } });
  const found = (await search(cookie, `?uhid=${patient.uhid.toLowerCase()}&from=2026-11-21&to=2026-11-21`)).json().prescriptions;
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({ date: prescription.date, uhid: patient.uhid, patientName: "Sample Patient", treatments: "Examination", teeth: "16", sittings: "1" });
  expect(JSON.parse(found[0].document)).toEqual(prescription);
  expect((await search(other)).json().prescriptions).toEqual([]);
  expect((await search(cookie, "?to=2026-11-20")).json().prescriptions).toEqual([]);
  expect((await search(cookie, "?from=2026-11-22&to=2026-11-21")).statusCode).toBe(400);
});
