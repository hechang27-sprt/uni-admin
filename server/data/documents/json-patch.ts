import { DocumentServiceError } from "./errors";
import type { JsonObject, JsonValue } from "./types";

export type JsonPatchOperation =
  | { op: "add"; path: string; value: JsonValue }
  | { op: "replace"; path: string; value: JsonValue }
  | { op: "remove"; path: string }
  | { op: "test"; path: string; value: JsonValue }
  | { op: string; path?: string; value?: JsonValue };

type Container = JsonObject | JsonValue[];

interface PointerTarget {
  parent: Container;
  key: string | number;
}

export function applyJsonPatch<TData extends JsonObject>(
  document: TData,
  operations: JsonPatchOperation[],
): TData {
  let result = cloneJson(document) as JsonValue;

  for (const operation of operations) {
    validatePatchOperation(operation);

    switch (operation.op) {
      case "add":
        result = addValue(
          result,
          operation.path,
          cloneJson(getPatchValue(operation)),
        );
        break;
      case "replace":
        result = replaceValue(
          result,
          operation.path,
          cloneJson(getPatchValue(operation)),
        );
        break;
      case "remove":
        result = removeValue(result, operation.path);
        break;
      case "test":
        testValue(result, operation.path, getPatchValue(operation));
        break;
    }
  }

  if (!isJsonObject(result) || Array.isArray(result)) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      "Patched document must remain a JSON object",
    );
  }

  return result as TData;
}

function validatePatchOperation(
  operation: JsonPatchOperation,
): asserts operation is JsonPatchOperation & {
  path: string;
} {
  if (
    operation.op !== "add" &&
    operation.op !== "replace" &&
    operation.op !== "remove" &&
    operation.op !== "test"
  ) {
    throw new DocumentServiceError(
      "UNSUPPORTED_OPERATION",
      `Unsupported JSON Patch operation: ${operation.op}`,
      {
        operation: operation.op,
      },
    );
  }

  if (typeof operation.path !== "string") {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      "JSON Patch operation path must be a string",
      {
        operation: operation.op,
      },
    );
  }

  if (
    (operation.op === "add" ||
      operation.op === "replace" ||
      operation.op === "test") &&
    !("value" in operation)
  ) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      `JSON Patch ${operation.op} operation requires a value`,
      {
        operation: operation.op,
        path: operation.path,
      },
    );
  }
}

function getPatchValue(operation: JsonPatchOperation): JsonValue {
  if (!("value" in operation) || operation.value === undefined) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      `JSON Patch ${operation.op} operation requires a value`,
      {
        operation: operation.op,
        path: operation.path,
      },
    );
  }

  return operation.value;
}

function addValue(
  root: JsonValue,
  pointer: string,
  value: JsonValue,
): JsonValue {
  if (pointer === "") {
    return value;
  }

  const target = resolveParent(root, pointer);

  if (Array.isArray(target.parent)) {
    const index = parseArrayIndex(target.parent, target.key, true, pointer);
    target.parent.splice(index, 0, value);
    return root;
  }

  target.parent[target.key as string] = value;
  return root;
}

function replaceValue(
  root: JsonValue,
  pointer: string,
  value: JsonValue,
): JsonValue {
  if (pointer === "") {
    return value;
  }

  const target = resolveExistingTarget(root, pointer);
  target.parent[target.key as never] = value as never;
  return root;
}

function removeValue(root: JsonValue, pointer: string): JsonValue {
  if (pointer === "") {
    return null;
  }

  const target = resolveExistingTarget(root, pointer);

  if (Array.isArray(target.parent)) {
    target.parent.splice(target.key as number, 1);
    return root;
  }

  delete target.parent[target.key as string];
  return root;
}

function testValue(
  root: JsonValue,
  pointer: string,
  expected: JsonValue,
): void {
  const actual = pointer === "" ? root : getExistingValue(root, pointer);

  if (!jsonEqual(actual, expected)) {
    throw new DocumentServiceError(
      "CONFLICT_PATCH_TEST_FAILED",
      "JSON Patch test operation failed",
      {
        path: pointer,
      },
    );
  }
}

function getExistingValue(root: JsonValue, pointer: string): JsonValue {
  const target = resolveExistingTarget(root, pointer);
  return target.parent[target.key as never] as JsonValue;
}

function resolveExistingTarget(
  root: JsonValue,
  pointer: string,
): PointerTarget {
  const target = resolveParent(root, pointer);

  if (Array.isArray(target.parent)) {
    const index = parseArrayIndex(target.parent, target.key, false, pointer);
    return { parent: target.parent, key: index };
  }

  if (!Object.prototype.hasOwnProperty.call(target.parent, target.key)) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      `JSON Pointer path does not exist: ${pointer}`,
      {
        path: pointer,
      },
    );
  }

  return target;
}

function resolveParent(root: JsonValue, pointer: string): PointerTarget {
  const segments = parsePointer(pointer);

  if (segments.length === 0) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      "JSON Pointer cannot resolve a parent for the document root",
      {
        path: pointer,
      },
    );
  }

  let current: JsonValue = root;

  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(current)) {
      current = current[
        parseArrayIndex(current, segment, false, pointer)
      ] as JsonValue;
      continue;
    }

    if (
      isJsonObject(current) &&
      Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      current = current[segment] as JsonValue;
      continue;
    }

    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      `JSON Pointer path does not exist: ${pointer}`,
      {
        path: pointer,
      },
    );
  }

  if (!isContainer(current)) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      `JSON Pointer parent is not a container: ${pointer}`,
      {
        path: pointer,
      },
    );
  }

  return { parent: current, key: segments[segments.length - 1]! };
}

function parsePointer(pointer: string): string[] {
  if (pointer === "") {
    return [];
  }

  if (!pointer.startsWith("/")) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      `Invalid JSON Pointer path: ${pointer}`,
      {
        path: pointer,
      },
    );
  }

  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function parseArrayIndex(
  array: JsonValue[],
  key: string | number,
  allowAppend: boolean,
  pointer: string,
): number {
  if (key === "-" && allowAppend) {
    return array.length;
  }

  const index = typeof key === "number" ? key : Number(key);

  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > array.length ||
    (!allowAppend && index === array.length)
  ) {
    throw new DocumentServiceError(
      "VALIDATION_FAILED",
      `Invalid JSON Pointer array index: ${pointer}`,
      {
        path: pointer,
      },
    );
  }

  return index;
}

function isContainer(value: JsonValue): value is Container {
  return Array.isArray(value) || isJsonObject(value);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<TValue extends JsonValue>(value: TValue): TValue {
  return JSON.parse(JSON.stringify(value)) as TValue;
}

function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => jsonEqual(value, right[index] as JsonValue))
    );
  }

  if (isJsonObject(left) && isJsonObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(right, key) &&
          jsonEqual(left[key] as JsonValue, right[key] as JsonValue),
      )
    );
  }

  return false;
}
