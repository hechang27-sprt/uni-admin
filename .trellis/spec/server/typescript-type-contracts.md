# TypeScript Type Contracts

## Scenario: Zod Validation as Type Construction

### 1. Scope / Trigger

- Trigger: defining server-side inputs, normalized domain values, config objects, or any value that must be validated before use.
- Prefer Zod schemas as executable constructors for validated types. Avoid maintaining a hand-written interface plus a separate validation schema when the schema can derive the type.
- Use Zod branded types as the project newtype pattern: the brand marks values that have crossed the validation/normalization boundary.

### 2. Signatures

```ts
const safeSlugSchema = z.string().regex(/^[a-z][a-z0-9-]*$/).brand<"SafeSlug">();
type SafeSlug = z.output<typeof safeSlugSchema>;

const inputSchema = z.object({
  key: safeSlugSchema.optional(),
  name: safeSlugSchema.optional(),
});
type Input = z.input<typeof inputSchema>;

const normalizedSchema = inputSchema
  .transform((input, context) => {
    const key = input.key ?? input.name;
    if (!key) {
      context.addIssue({ code: "custom", path: ["key"], message: "key or name required" });
      return z.NEVER;
    }

    return { ...input, key, name: input.name ?? key };
  })
  .brand<"NormalizedInput">();
type NormalizedInput = z.output<typeof normalizedSchema>;
```

### 3. Contracts

- Raw external or config-facing values use `z.input<typeof schema>`.
- Validated/normalized internal values use `z.output<typeof schema>`.
- If a type represents an invariant that plain object literals must not forge, brand it with `.brand<"Name">()`.
- Keep schema transforms responsible for deterministic normalization only. Stateful checks remain in the owning service/registry/repository.
- Runtime errors from parsing should be mapped to the layer's domain error type at the boundary.

### 4. Validation & Error Matrix

- Missing required normalized field -> parser issue -> boundary maps to domain validation error.
- Invalid primitive shape -> parser issue -> boundary maps to domain validation error.
- Object contains forbidden keys -> use `.strict()` where stale config must be rejected, not silently stripped.
- Duplicate/stateful conflict -> do not encode in Zod; validate in the stateful owner.

### 5. Good/Base/Bad Cases

- Good: a registry parser returns a branded `RegisteredCollection`, so downstream code cannot accidentally construct one without parsing.
- Base: optional compatibility input fields are normalized once by `.transform()` and downstream code receives required fields.
- Bad: a hand-written `RegisteredX = Omit<InputX, ...> & ...` type duplicates schema logic and drifts from runtime validation.

### 6. Tests Required

- Typecheck assertions: callers receive `z.output` types after parsing and cannot pass unvalidated objects where branded values are required.
- Unit tests: good input parses and receives normalized defaults.
- Unit tests: bad input rejects at the parsing boundary with the expected domain error.
- Unit tests: stale/forbidden keys are rejected when `.strict()` is part of the contract.

### 7. Wrong vs Correct

#### Wrong

```ts
type RegisteredThing = Omit<ThingInput, "optionalKey"> & {
  optionalKey: string;
};

function validateThing(input: ThingInput): void;
function normalizeThing(input: ThingInput): RegisteredThing;
```

This repeats the contract across manual types, validation, and normalization.

#### Correct

```ts
const registeredThingSchema = thingInputSchema
  .transform((input, context) => {
    const key = input.key ?? input.name;
    if (!key) {
      context.addIssue({ code: "custom", path: ["key"], message: "key or name required" });
      return z.NEVER;
    }

    return { ...input, key };
  })
  .brand<"RegisteredThing">();

type ThingInput = z.input<typeof thingInputSchema>;
type RegisteredThing = z.output<typeof registeredThingSchema>;
```

The schema is the constructor. The brand is the newtype proof that validation and normalization happened.
