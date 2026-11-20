// Checks a value against the JSON Schema subset that public/studies/schema.json uses. Unsupported
// keywords throw, so the schema can't silently ask for checks that never run.
export type Schema = { [keyword: string]: unknown };

const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', 'default', '$defs']);

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  return actual === type || (type === 'number' && actual === 'integer');
}

/** Returns one message per problem, each starting with the path of the offending value. */
export function checkSchema(value: unknown, schema: Schema, root: Schema = schema, path = 'config'): string[] {
  const problems: string[] = [];
  for (const [keyword, rule] of Object.entries(schema)) {
    if (ANNOTATIONS.has(keyword) || keyword === 'properties' || keyword === 'required') continue;
    switch (keyword) {
      case '$ref': {
        const ref = rule as string;
        if (!ref.startsWith('#/$defs/')) throw new Error(`Unsupported $ref ${ref}`);
        const target = (root.$defs as Record<string, Schema> | undefined)?.[ref.slice('#/$defs/'.length)];
        if (!target) throw new Error(`Unknown $ref ${ref}`);
        problems.push(...checkSchema(value, target, root, path));
        break;
      }
      case 'type': {
        const types = Array.isArray(rule) ? (rule as string[]) : [rule as string];
        if (!types.some((type) => matchesType(value, type))) {
          return [`${path} must be ${types.join(' or ')}`];
        }
        break;
      }
      case 'enum':
        if (!(rule as unknown[]).includes(value)) {
          problems.push(`${path} must be one of: ${(rule as unknown[]).map((v) => JSON.stringify(v)).join(', ')}`);
        }
        break;
      case 'anyOf':
        if (!(rule as Schema[]).some((option) => checkSchema(value, option, root, path).length === 0)) {
          problems.push(`${path} doesn't match any allowed form`);
        }
        break;
      case 'pattern':
        if (typeof value === 'string' && !new RegExp(rule as string, 'u').test(value)) {
          problems.push(`${path} has an invalid format`);
        }
        break;
      case 'minLength':
        if (typeof value === 'string' && value.length < (rule as number)) problems.push(`${path} is too short`);
        break;
      case 'maxLength':
        if (typeof value === 'string' && value.length > (rule as number)) problems.push(`${path} is too long`);
        break;
      case 'minimum':
        if (typeof value === 'number' && value < (rule as number)) problems.push(`${path} must be at least ${rule}`);
        break;
      case 'maximum':
        if (typeof value === 'number' && value > (rule as number)) problems.push(`${path} must be at most ${rule}`);
        break;
      case 'exclusiveMinimum':
        if (typeof value === 'number' && value <= (rule as number)) problems.push(`${path} must be more than ${rule}`);
        break;
      case 'minItems':
        if (Array.isArray(value) && value.length < (rule as number)) problems.push(`${path} needs at least ${rule} item(s)`);
        break;
      case 'maxItems':
        if (Array.isArray(value) && value.length > (rule as number)) problems.push(`${path} allows at most ${rule} items`);
        break;
      case 'items':
        if (Array.isArray(value)) {
          value.forEach((item, i) => problems.push(...checkSchema(item, rule as Schema, root, `${path}[${i}]`)));
        }
        break;
      case 'additionalProperties':
        if (rule !== false) throw new Error('Only additionalProperties: false is supported');
        if (typeOf(value) === 'object') {
          const known = (schema.properties ?? {}) as Record<string, Schema>;
          for (const key of Object.keys(value as object)) {
            if (!(key in known)) problems.push(`${path}.${key} is not a known field`);
          }
        }
        break;
      default:
        throw new Error(`Unsupported schema keyword "${keyword}" at ${path}`);
    }
  }
  if (typeOf(value) === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of (schema.required ?? []) as string[]) {
      if (!(key in object)) problems.push(`${path}.${key} is missing`);
    }
    for (const [key, sub] of Object.entries((schema.properties ?? {}) as Record<string, Schema>)) {
      if (key in object) problems.push(...checkSchema(object[key], sub, root, `${path}.${key}`));
    }
  }
  return problems;
}
