/**
 * Pivots an array of objects into an object of arrays.
 */
export function pivotToColumns<T extends Record<string, unknown>>(
  array: T[],
): { [K in keyof T]: T[K][] } {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Dynamic key initialization preserves each source property's value type.
  const result = {} as { [K in keyof T]: T[K][] };
  if (array.length === 0) {
    return result;
  }

  const keys = Object.keys(array[0]!) as Array<keyof T>;
  for (const key of keys) {
    result[key] = [];
  }

  for (const row of array) {
    for (const key of keys) {
      result[key].push(row[key]);
    }
  }

  return result;
}
