import { describe, expect, test } from 'bun:test';
import { parseSchema, referencePath, resolveSchema, type SchemaSource } from '../src/schema';
const src = (name: string, text: string): SchemaSource => ({ name, text, path: `.deepwork/schemas/${name}/deepschema.yml` });

describe('DeepSchema compatibility', () => {
  test('accepts every documented field and empty schemas', () => {
    expect(parseSchema('')).toEqual({});
    expect(parseSchema('{}')).toEqual({});
    expect(parseSchema(`summary: Example
instructions: Be specific
requirements:
  reliable_claims: Facts MUST be sourced.
parent_deep_schemas: [base]
json_schema_path: data.schema.json
verification_bash_command: ['test -f "$1"']
examples: [{path: example.md, description: A good example}]
references: [{path: reference.md, description: Guidance}]
matchers: ['**/*.md']`)).toHaveProperty('requirements.reliable_claims');
  });
  for (const invalid of ['- a', 'summary: 2', 'requirements: [a]', 'requirements: {bad.key: text}', 'requirements: {a: true}', 'references: [{path: x}]', 'matchers: x', 'summary: x\nsummary: y', 'unknown: true', 'examples: [{path: x, description: y, other: z}]']) {
    test(`rejects invalid schema ${invalid}`, () => expect(() => parseSchema(invalid)).toThrow());
  }
  test('resolves ordered parents and keeps inherited JSON Schema origin', () => {
    const a = src('a', 'requirements: {same: A, base: Base}\njson_schema_path: a.json\nverification_bash_command: [a]\ninstructions: Parent');
    const b = src('b', 'requirements: {same: B}\njson_schema_path: b.json\nverification_bash_command: [b]');
    const c = src('c', 'parent_deep_schemas: [a, b]\nrequirements: {child: Child}\nverification_bash_command: [c]');
    const result = resolveSchema(c, new Map([['a', a], ['b', b]]));
    expect(result.schema.requirements).toEqual({ same: 'B', base: 'Base', child: 'Child' });
    expect(result.schema.verification_bash_command).toEqual(['a', 'b', 'c']);
    expect(result.schema.json_schema_path).toBe('a.json');
    expect(result.jsonSchemaSource).toBe(a.path);
    expect(result.schema.instructions).toBeUndefined();
  });
  test('child overrides parent and diamond inheritance is not a cycle', () => {
    const a = src('a', 'requirements: {same: A}');
    const b = src('b', 'parent_deep_schemas: [a]');
    const c = src('c', 'parent_deep_schemas: [a, b]\nrequirements: {same: C}\njson_schema_path: c.json');
    const result = resolveSchema(c, new Map([['a', a], ['b', b]]));
    expect(result.schema.requirements).toEqual({ same: 'C' });
    expect(result.jsonSchemaSource).toBe(c.path);
  });
  test('reports missing parents and cycles', () => {
    const a = src('a', 'parent_deep_schemas: [b]');
    const b = src('b', 'parent_deep_schemas: [a]');
    expect(() => resolveSchema(a, new Map())).toThrow('Unknown parent');
    expect(() => resolveSchema(a, new Map([['a', a], ['b', b]]))).toThrow('Circular');
  });
  test('reference resolution stays inside the vault', () => {
    expect(referencePath('.deepwork/schemas/a/deepschema.yml', '../../../Reference.md')).toBe('Reference.md');
    for (const ref of ['../../../../secret', '/etc/passwd', 'C:\\secret', 'file:///secret', '\0', '../secret']) {
      expect(() => referencePath('.deepschema.note.md.yml', ref)).toThrow();
    }
  });
});
