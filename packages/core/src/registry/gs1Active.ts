/** Single evaluation point for {@link ObjectTypeCore.gs1Active}; lives below
 *  the registry so a symbology core can share it without a cycle. */
export function isGs1Active(
  entry: { gs1Capable?: boolean; gs1Active?: (props: object) => boolean } | undefined,
  props: object | undefined,
): boolean {
  if (!entry || !props) return false;
  if (entry.gs1Active) return entry.gs1Active(props);
  return entry.gs1Capable === true && (props as { gs1?: boolean }).gs1 === true;
}
