import { stripVTControlCharacters } from 'node:util';

// Remote text must never become terminal commands, clipboard operations, or
// hidden direction overrides. Keep ordinary Unicode, including emoji joiners.
export function plainText(value) {
  return stripVTControlCharacters(String(value ?? ''))
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
