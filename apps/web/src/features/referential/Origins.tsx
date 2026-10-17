import type { CabinetRecord } from "@memlia/contracts";
import { columnLabels } from "../records/columns";
const origins = {
  manual: "Saisie du cabinet",
  import: "Reprise de fichier",
  public: "Recherche publique",
  simulated: "Fournisseur simulé",
  supplier: "Fournisseur",
};
export function Origins({ record }: { record: CabinetRecord }) {
  return (
    <details>
      <summary>Origine et date des valeurs enregistrées</summary>
      <table>
        <thead>
          <tr>
            <th>Champ</th>
            <th>Origine</th>
            <th>Date</th>
            <th>Version</th>
            <th>Référence</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(record.data.fieldOrigins).map(([key, source]) => (
            <tr key={key}>
              <td>{columnLabels[key] ?? key}</td>
              <td>{origins[source.kind]}</td>
              <td>{new Date(source.at).toLocaleString("fr-FR")}</td>
              <td>{source.version}</td>
              <td>{source.reference}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
