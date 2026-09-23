import assert from 'node:assert/strict';
import test from 'node:test';

import { lookupRequestSchema } from './lookup.ts';

test('accepts a remote image URL and applies lookup defaults', () => {
  const input = lookupRequestSchema.parse({
    imageUrl: 'https://example.com/jacket.jpg',
  });

  assert.equal(input.maxResults, 5);
  assert.equal(input.provider, undefined);
});

test('accepts an image data URL for local testing', () => {
  const input = lookupRequestSchema.parse({
    imageUrl: 'data:image/png;base64,aGVsbG8=',
    provider: 'openai',
    maxResults: 3,
  });

  assert.equal(input.provider, 'openai');
  assert.equal(input.maxResults, 3);
});

test('rejects unsupported image URL schemes', () => {
  const result = lookupRequestSchema.safeParse({
    imageUrl: 'file:///private/photo.jpg',
  });

  assert.equal(result.success, false);
});
