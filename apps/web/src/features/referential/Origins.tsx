import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "../../upstream/twenty/Table";
import type { CabinetRecord } from "@memlia/contracts";
import { columnLabels } from "../records/columns";
const origins = {
  manual: "Saisie du cabinet",
  import: "Reprise de fichier",
  public: "Recherche publique",
  simulated: "Fournisseur simulé",
  supplier: "Fournisseur",
  generated: "Génération locale",
};
export function Origins({ record }: { record: CabinetRecord }) {
  return (
    <details>
      <summary>Origine et date des valeurs enregistrées</summary>
      <Table>
        <thead>
          <TableRow>
            <TableHeader>Champ</TableHeader>
            <TableHeader>Origine</TableHeader>
            <TableHeader>Date</TableHeader>
            <TableHeader>Version</TableHeader>
            <TableHeader>Référence</TableHeader>
          </TableRow>
        </thead>
        <tbody>
          {Object.entries(record.data.fieldOrigins).map(([key, source]) => (
            <TableRow key={key}>
              <TableCell>{columnLabels[key] ?? key}</TableCell>
              <TableCell>{origins[source.kind]}</TableCell>
              <TableCell>
                {new Date(source.at).toLocaleString("fr-FR")}
              </TableCell>
              <TableCell>{source.version}</TableCell>
              <TableCell>{source.reference}</TableCell>
            </TableRow>
          ))}
        </tbody>
      </Table>
    </details>
  );
}
