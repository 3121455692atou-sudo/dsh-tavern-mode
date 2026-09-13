// JSON Schema checks use installed Python jsonschema, NOT a mock that always
// passes. This does NOT certify AJV strict-mode compilation or SDK integration.
import { spawnSync } from 'node:child_process';
const script = `import sys,json
from jsonschema import Draft7Validator
x=json.load(sys.stdin)
errors=[]
for e in Draft7Validator(x['schema']).iter_errors(x['value']):
 path=''.join('/'+str(k).replace('~','~0').replace('/','~1') for k in e.absolute_path)
 errors.append({'instancePath':path,'keyword':e.validator,'message':e.message,'params':{}})
print(json.dumps(errors))`;
const cache = new Map();
export default class SchemaValidator {
  compile(schema) {
    const validate = value => {
      const key = JSON.stringify([schema, value]);
      if (cache.has(key)) { validate.errors = structuredClone(cache.get(key)); return !validate.errors.length; }
      const result = spawnSync('python', ['-c', script], { input: JSON.stringify({ schema, value }), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      if (result.status !== 0) throw new Error(result.stderr || 'offline schema validation failed');
      validate.errors = JSON.parse(result.stdout);
      cache.set(key, structuredClone(validate.errors));
      if (cache.size > 128) cache.delete(cache.keys().next().value);
      return !validate.errors.length;
    };
    return validate;
  }
  removeSchema() {}
  errorsText(errors, { separator = '; ' } = {}) { return errors.map(error => `data${error.instancePath} ${error.message}`).join(separator); }
}
