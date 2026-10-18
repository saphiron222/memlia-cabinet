import { createHash } from "node:crypto";
import { z } from "zod";
import { CompanyValuesSchema } from "@memlia/contracts";
import { fail } from "../errors.js";
const establishment = z.object({
  siret: z.string().regex(/^\d{14}$/),
  nom_commercial: z.string().nullish(),
  adresse: z.string().nullish(),
  code_postal: z.string().nullish(),
  libelle_commune: z.string().nullish(),
  est_siege: z.boolean().nullish(),
  date_creation: z.string().nullish(),
});
const publicResult = z.object({
  results: z
    .array(
      z.object({
        siren: z.string().regex(/^\d{9}$/),
        nom_complet: z.string().min(1),
        nature_juridique: z.string().nullish(),
        activite_principale: z.string().nullish(),
        date_creation: z.string().nullish(),
        siege: establishment.nullish(),
        matching_etablissements: z.array(establishment).nullish(),
      }),
    )
    .max(25),
  total_results: z.number().int().nonnegative(),
  page: z.number().int().positive(),
});
export class CompanySearch {
  constructor(private origin: string) {
    const u = new URL(origin);
    if (
      u.origin !== origin ||
      !(
        origin === "https://recherche-entreprises.api.gouv.fr" ||
        ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
      )
    )
      throw new Error("Origine de recherche refusée.");
  }
  async search(q: string, page: number) {
    const url = new URL("/search", this.origin);
    url.search = new URLSearchParams({
      q,
      page: String(page),
      per_page: "10",
      minimal: "true",
      include: "siege,matching_etablissements",
      limite_matching_etablissements: "10",
    }).toString();
    try {
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          "User-Agent": "Memlia-Cabinet/0.1 (recherche explicite)",
          accept: "application/json",
        },
      });
      if (response.status === 429)
        fail(
          429,
          "COMPANY_RATE_LIMITED",
          "Service public temporairement limité.",
          {
            retryAfter:
              response.headers.get("retry-after")?.slice(0, 100) ?? null,
          },
        );
      if (response.status === 400)
        fail(
          400,
          "COMPANY_QUERY_INVALID",
          "Recherche refusée par le service public.",
        );
      if (!response.ok)
        fail(503, "COMPANY_UNAVAILABLE", "Service public indisponible.");
      if (!response.body)
        fail(502, "COMPANY_RESPONSE_INVALID", "Réponse publique invalide.");
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) {
          await reader.cancel();
          fail(
            502,
            "COMPANY_RESPONSE_INVALID",
            "Réponse publique trop volumineuse.",
          );
        }
        chunks.push(value);
      }
      const parsed = publicResult.safeParse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      if (!parsed.success)
        fail(502, "COMPANY_RESPONSE_INVALID", "Réponse publique invalide.");
      return {
        page: parsed.data.page,
        total: parsed.data.total_results,
        values: parsed.data.results.map((r) => {
          const establishments = [
            ...new Map(
              [
                ...(r.siege ? [r.siege] : []),
                ...(r.matching_etablissements ?? []),
              ].map((e) => [e.siret, e]),
            ).values(),
          ].map((e) => ({
            id: hashUuid(e.siret),
            siret: e.siret,
            name: e.nom_commercial ?? r.nom_complet,
            headOffice: e.est_siege ?? false,
            address: {
              line1: e.adresse ?? "",
              postalCode: e.code_postal ?? "",
              city: e.libelle_commune ?? "",
              country: "FR",
            },
          }));
          return CompanyValuesSchema.parse({
            title: r.nom_complet,
            siren: r.siren,
            legalForm: r.nature_juridique ?? "",
            activityCode: r.activite_principale ?? "",
            establishments,
          });
        }),
      };
    } catch (e) {
      if (e instanceof Error && "status" in e) throw e;
      if (e instanceof SyntaxError)
        fail(502, "COMPANY_RESPONSE_INVALID", "Réponse publique invalide.");
      fail(
        503,
        "COMPANY_UNAVAILABLE",
        "Service public indisponible ou délai dépassé.",
      );
    }
  }
}
function hashUuid(text: string) {
  const hex = createHash("sha256").update(text).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
