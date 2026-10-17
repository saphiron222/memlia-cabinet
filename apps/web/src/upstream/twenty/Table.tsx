/** Twenty contributors, AGPLv3 + Twenty Application Exception, see LICENSE.
 * Port of ui/layout/table/{Table,TableRow,TableHeader,TableCell}.ts(x).
 * Linaria theme/prop interpolation becomes CSS variables. Native table semantics
 * replace div/grid so fiscal merged cells and canonical export column order survive.
 * Sorting, pagination and capabilities remain controlled by the canonical caller.
 */
import type { ComponentProps, CSSProperties } from "react";
import "./table.css";
export function Table({ className = "", ...props }: ComponentProps<"table">) {
  return <table className={`tw-source-table ${className}`} {...props} />;
}
export function TableRow({ className = "", ...props }: ComponentProps<"tr">) {
  return (
    <tr data-table-row className={`tw-source-row ${className}`} {...props} />
  );
}
export function TableHeader({
  className = "",
  ...props
}: ComponentProps<"th">) {
  return (
    <th
      data-table-header
      className={`tw-source-header ${className}`}
      {...props}
    />
  );
}
type CellProps = ComponentProps<"td"> & {
  gap?: string;
  height?: string;
  maxWidth?: string;
  minWidth?: string;
  overflow?: string;
  padding?: string;
  textOverflow?: string;
  whiteSpace?: string;
  clickable?: boolean;
};
export function TableCell({
  className = "",
  gap,
  height,
  maxWidth,
  minWidth,
  overflow,
  padding,
  textOverflow,
  whiteSpace,
  clickable,
  style,
  ...props
}: CellProps) {
  const variables = {
    "--cell-gap": gap,
    "--cell-height": height,
    "--cell-max-width": maxWidth,
    "--cell-min-width": minWidth,
    "--cell-overflow": overflow,
    "--cell-padding": padding,
    "--cell-text-overflow": textOverflow,
    "--cell-white-space": whiteSpace,
    cursor: clickable ? "pointer" : undefined,
    ...style,
  } as CSSProperties;
  return (
    <td
      className={`tw-source-cell ${className}`}
      style={variables}
      {...props}
    />
  );
}
