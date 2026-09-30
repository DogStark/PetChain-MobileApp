/**
 * #977 — Validate backend OpenAPI against the handwritten mobile client.
 *
 * Covers the normalizer, the drift detector, and a live check that the
 * critical mobile REST surface (auth, pets, medical records, appointments,
 * medications) is actually documented in backend/docs/openapi.json.
 */
import * as fs from 'fs';
import * as path from 'path';

import { normalizePath, findUndocumented } from '../validate-openapi-client';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head';

function loadRoutes(): Map<string, Set<Method>> {
  const spec = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../backend/docs/openapi.json'), 'utf-8'),
  ) as { paths: Record<string, Record<string, unknown>> };
  const routes = new Map<string, Set<Method>>();
  for (const [p, ops] of Object.entries(spec.paths)) {
    const key = p.replace(/\{[^}]+\}/g, '{param}');
    routes.set(
      key,
      new Set(Object.keys(ops).filter((m) =>
        ['get', 'post', 'put', 'patch', 'delete', 'head'].includes(m),
      ) as Method[]),
    );
  }
  return routes;
}

describe('normalizePath', () => {
  it('rewrites template-literal params to the spec {param} form', () => {
    expect(normalizePath('/pets/${petId}/medical-records')).toBe('/pets/{param}/medical-records');
  });
  it('rewrites express-style :params and strips query + trailing slash', () => {
    expect(normalizePath('pets/:id/?expand=owner')).toBe('/pets/{param}');
  });
});

describe('findUndocumented', () => {
  const routes = loadRoutes();

  it('flags a client call the spec does not document', () => {
    const undoc = findUndocumented(
      [{ file: 'x.ts', method: 'post', rawPath: '/ghost', normalized: '/ghost' }] as never,
      routes,
    );
    expect(undoc).toHaveLength(1);
  });

  it('flags a documented path used with an undocumented method', () => {
    // /pets/{id} documents get/put/delete but not patch
    const undoc = findUndocumented(
      [{ file: 'x.ts', method: 'patch', rawPath: '/pets/${id}', normalized: '/pets/{param}' }] as never,
      routes,
    );
    expect(undoc).toHaveLength(1);
  });

  it('passes a correctly documented call', () => {
    const undoc = findUndocumented(
      [{ file: 'x.ts', method: 'get', rawPath: '/pets/${id}', normalized: '/pets/{param}' }] as never,
      routes,
    );
    expect(undoc).toHaveLength(0);
  });
});

describe('critical mobile REST surface is documented (#977)', () => {
  const routes = loadRoutes();

  it.each<[string, Method]>([
    ['/auth/login', 'post'],
    ['/auth/refresh', 'post'],
    ['/auth/forgot-password', 'post'],
    ['/users/me', 'get'],
    ['/pets', 'get'],
    ['/pets', 'post'],
    ['/pets/{param}', 'get'],
    ['/pets/{param}', 'put'],
    ['/pets/qr/{param}', 'get'],
    ['/medical-records', 'post'],
    ['/pets/{param}/medical-records', 'get'],
    ['/appointments', 'post'],
    ['/appointments/{param}', 'put'],
    ['/medications', 'post'],
  ])('documents %s %s', (route, method) => {
    expect(routes.get(route)?.has(method)).toBe(true);
  });
});
