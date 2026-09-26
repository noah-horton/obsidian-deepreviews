import { parseDocument } from 'yaml';
import { posix } from 'node:path';

export interface SchemaLink { path: string; description: string }
export interface DeepSchema {
  summary?: string;
  instructions?: string;
  requirements?: Record<string, string>;
  parent_deep_schemas?: string[];
  json_schema_path?: string;
  verification_bash_command?: string[];
  examples?: SchemaLink[];
  references?: SchemaLink[];
  matchers?: string[];
}
export interface SchemaSource { name: string; path: string; text: string }
export interface ResolvedSchema {
  schema: DeepSchema;
  source: SchemaSource;
  lineage: SchemaSource[];
  jsonSchemaSource?: string;
}

export const DEFAULT_SCHEMA = `summary: General note
instructions: |
  Review the note for clarity, completeness, and internal consistency.
requirements:
  consistent: The note is internally consistent, including any referenced additional files
  spelling: Spelling and grammar is correct (ignoring anything where it appears to be a proper name or reference)
`;

const stringFields = ['summary', 'instructions', 'json_schema_path'] as const;
const listFields = ['parent_deep_schemas', 'verification_bash_command', 'matchers'] as const;
const linkFields = ['examples', 'references'] as const;
const allowed = new Set<string>([...stringFields, ...listFields, ...linkFields, 'requirements']);
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Independently implemented validation of the public DeepSchema YAML format. */
export function parseSchema(text: string): DeepSchema {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  const value: unknown = doc.toJS({ maxAliasCount: 50 }) ?? {};
  if (!isObject(value)) throw new Error('A DeepSchema must be a YAML mapping.');
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Unknown DeepSchema field: ${key}`);
  }
  for (const key of stringFields) {
    if (key in value && typeof value[key] !== 'string') throw new Error(`${key} must be a string.`);
  }
  for (const key of listFields) {
    if (key in value && (!Array.isArray(value[key]) || !value[key].every(x => typeof x === 'string'))) {
      throw new Error(`${key} must be a list of strings.`);
    }
  }
  if ('requirements' in value) {
    if (!isObject(value.requirements)) throw new Error('requirements must map names to descriptions.');
    for (const [name, description] of Object.entries(value.requirements)) {
      if (!/^[a-zA-Z0-9_-]+$/.test(name) || typeof description !== 'string') {
        throw new Error(`Requirement ${name} needs an alphanumeric/hyphen/underscore name and a string description.`);
      }
    }
  }
  for (const key of linkFields) {
    if (!(key in value)) continue;
    if (!Array.isArray(value[key]) || !value[key].every(x => isObject(x)
      && typeof x.path === 'string' && typeof x.description === 'string'
      && Object.keys(x).every(k => k === 'path' || k === 'description'))) {
      throw new Error(`${key} must be a list of { path, description } entries.`);
    }
  }
  return value as DeepSchema;
}

/** Later parents override earlier parents; children override every parent. */
export function resolveSchema(source: SchemaSource, named: Map<string, SchemaSource>, chain: string[] = []): ResolvedSchema {
  if (chain.includes(source.path)) throw new Error(`Circular schema inheritance: ${[...chain, source.path].join(' → ')}`);
  if (chain.length >= 50) throw new Error('Schema inheritance exceeds 50 levels.');
  const schema = parseSchema(source.text);
  let requirements: Record<string, string> = {};
  const commands: string[] = [];
  const lineage: SchemaSource[] = [];
  let inheritedJson: string | undefined;
  let jsonSchemaSource: string | undefined;
  for (const name of schema.parent_deep_schemas ?? []) {
    const parent = named.get(name);
    if (!parent) throw new Error(`Unknown parent schema: ${name}`);
    const resolved = resolveSchema(parent, named, [...chain, source.path]);
    requirements = { ...requirements, ...resolved.schema.requirements };
    commands.push(...resolved.schema.verification_bash_command ?? []);
    lineage.push(...resolved.lineage);
    if (!inheritedJson && resolved.schema.json_schema_path) {
      inheritedJson = resolved.schema.json_schema_path;
      jsonSchemaSource = resolved.jsonSchemaSource;
    }
  }
  if (schema.json_schema_path) jsonSchemaSource = source.path;
  return {
    source, lineage: [...lineage, source], jsonSchemaSource,
    schema: {
      ...schema,
      requirements: { ...requirements, ...schema.requirements },
      verification_bash_command: [...commands, ...schema.verification_bash_command ?? []],
      json_schema_path: schema.json_schema_path || inheritedJson
    }
  };
}

/** References may walk up within the vault, but may not escape it. */
export function referencePath(schemaPath: string, reference: string): string {
  if (!reference || reference.includes('\0') || reference.includes('\\') || posix.isAbsolute(reference) || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(reference)) {
    throw new Error(`Reference must be a relative vault path: ${reference}`);
  }
  const path = posix.normalize(posix.join(posix.dirname(schemaPath), reference));
  if (path === '..' || path.startsWith('../')) throw new Error(`Reference leaves the vault: ${reference}`);
  return path;
}
export const isWebReference = (path: string): boolean => /^https?:\/\//i.test(path);
