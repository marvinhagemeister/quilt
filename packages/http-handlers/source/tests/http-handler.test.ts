import '@quilted/polyfills/fetch';

import {describe, it, expect} from '@quilted/testing';
import {createHttpHandler} from '../http-handler';
import {noContent} from '../response-helpers';

describe('createHttpHandler()', () => {
  it('can register a handler for any method and path', async () => {
    const response = noContent();
    const handler = createHttpHandler();
    handler.any(() => response);

    expect(await handler.run(new Request(url('/')))).toBe(response);
    expect(await handler.run(new Request(url('/any-path')))).toBe(response);
  });

  it('can register a handler for a specific method', async () => {
    const response = noContent();
    const handler = createHttpHandler();
    handler.get(() => response);

    expect(await handler.run(new Request(url('/'), {method: 'GET'}))).toBe(
      response,
    );
    expect(
      await handler.run(new Request(url('/'), {method: 'POST'})),
    ).toBeUndefined();
  });

  it('can register a handler for a string path', async () => {
    const response = noContent();
    const handler = createHttpHandler();
    handler.get('/', () => response);

    expect(await handler.run(new Request(url('/')))).toBe(response);
    expect(await handler.run(new Request(url('/not-a-match')))).toBeUndefined();
  });

  it('can register a handler for a regular expression path', async () => {
    const response = noContent();
    const handler = createHttpHandler();
    handler.get(/\d+/, () => response);

    expect(await handler.run(new Request(url('/123')))).toBe(response);
    expect(await handler.run(new Request(url('/hello')))).toBeUndefined();
  });

  it('can register a handler for a non-exact match', async () => {
    const response = noContent();
    const handler = createHttpHandler();
    handler.get('/hello', () => response, {exact: false});

    expect(await handler.run(new Request(url('/')))).toBeUndefined();
    expect(await handler.run(new Request(url('/hello')))).toBe(response);
    expect(await handler.run(new Request(url('/hello/world')))).toBe(response);
  });

  it('excludes a prefix before attempting to match', async () => {
    const response = noContent();
    const handler = createHttpHandler({prefix: '/hello'});
    handler.get('/world', () => response);

    expect(await handler.run(new Request(url('/hello/world')))).toBe(response);
    expect(
      await handler.run(new Request(url('/hello/goodbye'))),
    ).toBeUndefined();
    expect(await handler.run(new Request(url('/world')))).toBeUndefined();
  });

  it('expands matches in nested http handlers', async () => {
    const response = noContent();
    const handler = createHttpHandler();
    const nestedHandler = createHttpHandler();
    nestedHandler.get('world', () => response);
    handler.get('hello', nestedHandler);

    expect(await handler.run(new Request(url('/hello/world')))).toBe(response);
    expect(
      await handler.run(new Request(url('/hello/goodbye'))),
    ).toBeUndefined();
    expect(await handler.run(new Request(url('/world')))).toBeUndefined();
  });

  it('expands matches and prefixes in nested http handlers', async () => {
    const response = noContent();
    const handler = createHttpHandler();
    const nestedHandler = createHttpHandler({prefix: 'world'});
    nestedHandler.get('/', () => response);
    handler.get('hello', nestedHandler);

    expect(await handler.run(new Request(url('/hello/world')))).toBe(response);
    expect(
      await handler.run(new Request(url('/hello/world/beyond'))),
    ).toBeUndefined();
    expect(
      await handler.run(new Request(url('/hello/goodbye'))),
    ).toBeUndefined();
    expect(await handler.run(new Request(url('/world')))).toBeUndefined();
  });
});

function url(path: string) {
  return new URL(path, 'https://example.dev');
}
