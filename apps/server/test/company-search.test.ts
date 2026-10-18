import { createServer } from "node:http";
import { expect, test } from "vitest";
import { fixture, operationId } from "./helpers.js";
test("recherche entreprise : vrai HTTP local, sélection propose seulement, SIRET demandé distinct du siège", async () => {
  let requested = "";
  const server = createServer((req, res) => {
    requested = req.url ?? "";
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        results: [
          {
            siren: "001234567",
            nom_complet: "Entreprise publique fictive",
            nature_juridique: "5499",
            siege: {
              siret: "00123456700012",
              adresse: "Siège fictif",
              est_siege: true,
            },
            matching_etablissements: [
              {
                siret: "00123456700020",
                adresse: "Agence fictive",
                est_siege: false,
              },
            ],
          },
        ],
        page: 1,
        total_results: 1,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const f = await fixture(undefined, {
    companySearchOrigin: `http://127.0.0.1:${address.port}`,
  });
  try {
    await f.setup();
    const result = await f.request(
      "GET",
      "/administration/companies/search?q=00123456700020",
    );
    expect(result.statusCode).toBe(200);
    expect(requested).toContain("q=00123456700020");
    expect(
      result
        .json()
        .items[0].values.establishments.map((e: { siret: string }) => e.siret),
    ).toEqual(["00123456700012", "00123456700020"]);
    const proposal = await f.request(
      "POST",
      "/administration/companies/propose",
      {
        operationId: operationId(),
        candidateId: result.json().items[0].candidateId,
      },
    );
    expect(proposal.statusCode).toBe(200);
    expect(proposal.json().origin.kind).toBe("public");
    expect((await f.request("GET", "/records?kind=dossier")).json().total).toBe(
      0,
    );
  } finally {
    await f.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test.each([
  { status: 429, body: "{}", expected: "COMPANY_RATE_LIMITED" },
  { status: 503, body: "{}", expected: "COMPANY_UNAVAILABLE" },
  { status: 200, body: "pas du json", expected: "COMPANY_RESPONSE_INVALID" },
  { status: 400, body: "{}", expected: "COMPANY_QUERY_INVALID" },
])(
  "recherche publique : refus explicite $expected sans portail réel",
  async ({ status, body, expected }) => {
    const server = createServer((_req, res) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "retry-after": "30",
      });
      res.end(body);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const f = await fixture(undefined, {
      companySearchOrigin: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    });
    try {
      await f.setup();
      const r = await f.request(
        "GET",
        "/administration/companies/search?q=fictif",
      );
      expect(r.json().error.code).toBe(expected);
    } finally {
      await f.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
