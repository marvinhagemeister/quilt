import * as path from 'path';
import {createRequire} from 'module';
import {rm} from 'fs/promises';

import {stripIndent} from 'common-tags';

import type {HttpState, AssetBuild} from '@quilted/quilt/server';
import type {Options as StaticRenderOptions} from '@quilted/quilt/static';

import {createProjectPlugin, Runtime, TargetRuntime} from '../kit';
import type {App, WaterfallHook, WaterfallHookWithDefault} from '../kit';
import {
  MAGIC_MODULE_APP_ASSET_MANIFEST,
  MAGIC_MODULE_APP_COMPONENT,
} from '../constants';

import {STEP_NAME} from './app-build';

export interface AppStaticOptions {
  /**
   * The initial routes to statically render for this application.
   * Quilt will render these pages and, if the `crawl` option is
   * `true`, will statically any other routes you declare while
   * rendering the first batch.
   *
   * @default ['/']
   * @example ['/admin', '/internal']
   */
  routes?: string[] | (() => string[] | Promise<string[]>);

  /**
   * Whether Quilt should render additional routes it finds while
   * rendering the ones resolved from the `routes` option.
   *
   * @default true
   */
  crawl?: boolean;

  /**
   * Whether the HTML files that Quilt builds should be “prettified”
   * by running them through Prettier.
   *
   * @default true
   */
  prettify?: boolean;
}

export interface AppStaticBuildOptions {
  /**
   * Indicates that the static app build is being generated by Quilt.
   */
  quiltAppStatic: boolean;
}

export interface StaticWriteRouteContext {
  /**
   * The pathname of the route that was rendered. Routes are normalized
   * so that they are always absolute (prefixed with a `/`), and any trailing
   * `/` are removed.
   *
   * @example '/about/us'
   */
  route: string;

  /**
   * Whether there are any routes that are nested below this one.
   */
  hasChildren: boolean;

  /**
   * Whether the route being rendered was a “forced fallback”. When Quilt
   * discovers a route without a `match` field, it will render the parent
   * route with the `fallback` option set to `true`, and will forcibly render
   * the fallback route definition instead of whatever route would normally
   * render there.
   *
   * For example, if you had these two routes defined for your application:
   *
   * ```tsx
   * import {useRoutes} from '@quilted/quilt';
   *
   * export function Routes() {
   *   useRoutes([
   *     {match: '/', render: () => <Start />},
   *     {render: () => <Fallback />},
   *   ]);
   * }
   * ```
   *
   * Quilt will call the `quiltStaticBuildWriteRoute` with the following
   * rendered routes:
   *
   * `{route: '/', fallback: false, http: {...}}` for the explicit `match: '/'` route
   * `{route: '/', fallback: true, http: {...}}` for the explicit fallback route
   */
  fallback: boolean;

  /**
   * The HTTP details that were extracted while rendering the application,
   * including the headers and status code.
   */
  http: HttpState;
}

export interface AppStaticHooks {
  /**
   * The initial routes to statically render for this application.
   * Quilt will render these pages and, if the result of the
   * `quiltStaticBuildCrawl` hook is `true`, will statically any
   * other routes you declare while rendering the first batch.
   *
   * This hook defaults to the value provided by the developer for
   * the `static.routes` option for this plugin, or ['/'] if that
   * option is not set.
   *
   * Routes should be declared with a leading `/` (e.g., [`/internal`, `/admin`]).
   */
  quiltStaticBuildRoutes: WaterfallHookWithDefault<string[]>;

  /**
   * Whether Quilt should render additional routes it finds while
   * rendering the ones resolved from the `quiltStaticBuildRoutes` hook.
   * Defaults to the value the user passes for `static.crawl`, or
   * `true` if that option is not set.
   */
  quiltStaticBuildCrawl: WaterfallHookWithDefault<boolean>;

  /**
   * Whether the HTML files that Quilt builds should be “prettified”
   * by running them through Prettier. Defaults to the value provided
   * for `static.prettify`, or `true` if that is not set.
   */
  quiltStaticBuildPrettify: WaterfallHookWithDefault<boolean>;

  /**
   * Called for each route that Quilt statically rendered. The return
   * result of this hook should be the filename to use (without a leading
   * `/`, but potentially with slashes in the filename, like
   * `admin/start.html`), or `false` to not write this route to disk.
   * The second argument to this hook is context about the route being
   * rendered, including its pathname (e.g., `/admin/start`), whether
   * it is a fallback route, and the HTTP details recorded while rendering.
   */
  quiltStaticBuildWriteRoute: WaterfallHook<
    string | false,
    [StaticWriteRouteContext]
  >;
}

declare module '@quilted/sewing-kit' {
  interface BuildAppOptions extends AppStaticBuildOptions {}
  interface BuildAppConfigurationHooks extends AppStaticHooks {}
}

const MAGIC_ENTRY_MODULE = '__quilt__/AppStaticEntry';

const require = createRequire(import.meta.url);

export function appStatic({
  routes = ['/'],
  crawl = true,
  prettify = true,
}: AppStaticOptions = {}) {
  return createProjectPlugin<App>({
    name: 'Quilt.App.Static',
    build({project, internal, hooks, configure, run}) {
      const nodeScriptOutputDirectory = internal.fs.tempPath(
        'quilt-static',
        project.name,
      );
      const outputFilename = 'index.js';
      const outputFile = path.join(nodeScriptOutputDirectory, outputFilename);

      hooks<AppStaticHooks>(({waterfall}) => ({
        quiltStaticBuildRoutes: waterfall<string[]>({
          default: async () => {
            const resolved =
              typeof routes === 'function' ? await routes() : routes;
            return Array.from(resolved);
          },
        }),
        quiltStaticBuildCrawl: waterfall({
          default: crawl,
        }),
        quiltStaticBuildPrettify: waterfall({
          default: prettify,
        }),
        quiltStaticBuildWriteRoute: waterfall(),
      }));

      configure(
        (
          {
            runtime,
            targets,
            postcssPlugins,
            postcssProcessOptions,
            rollupInput,
            rollupPlugins,
            rollupExternals,
            rollupOutputs,
            quiltAsyncPreload,
            quiltAsyncManifest,
          },
          {quiltAppStatic = false},
        ) => {
          if (!quiltAppStatic) return;

          runtime?.(() => new TargetRuntime([Runtime.Node]));
          targets?.(() => ['current node']);

          rollupInput?.(() => [MAGIC_ENTRY_MODULE]);

          // Let prettier use native Node resolution, we include it as
          // a dependency.
          rollupExternals?.((externals) => {
            // externals.push('prettier');
            return externals;
          });

          quiltAsyncPreload?.(() => false);
          quiltAsyncManifest?.(() => false);

          rollupPlugins?.(async (plugins) => {
            const {cssRollupPlugin} = await import('./rollup/css');
            const resolvedPrettier = require.resolve('prettier');

            // Our static generation script depends on prettier. If we just
            // mark it as external, it needs to be able to be resolved from
            // the developer’s root node_modules. Since `prettier` is a dependency
            // of quilt, most developers will not install it directly, and
            // in that case stricter package managers (like pnpm) will not
            // make it accessible from the root directory.
            //
            // To solve this problem, we mark `prettier` as external, and
            // resolve to our own internal dependency version, which is
            // guaranteed to be present.
            plugins.unshift({
              name: '@quilted/rewrite-prettier',
              resolveId(id) {
                if (id === 'prettier') {
                  return {
                    id: path.relative(
                      path.dirname(outputFile),
                      resolvedPrettier,
                    ),
                    external: true,
                  };
                }

                return null;
              },
            });

            plugins.push(
              cssRollupPlugin({
                extract: false,
                postcssPlugins: () => postcssPlugins!.run(),
                postcssProcessOptions: () => postcssProcessOptions!.run(),
              }),
            );

            plugins.unshift({
              name: '@quilted/magic-module/static-asset-manifest',
              async resolveId(id) {
                if (id === MAGIC_MODULE_APP_ASSET_MANIFEST) {
                  return id;
                }

                return null;
              },
              async load(source) {
                if (source !== MAGIC_MODULE_APP_ASSET_MANIFEST) {
                  return null;
                }

                const manifestFiles = await project.fs.glob('manifest*.json', {
                  cwd: project.fs.buildPath('manifests'),
                  onlyFiles: true,
                });

                const manifests = (
                  await Promise.all(
                    manifestFiles.map(async (manifestFile) => {
                      const manifestString = await project.fs.read(
                        manifestFile,
                      );

                      return JSON.parse(manifestString) as AssetBuild;
                    }),
                  )
                )
                  // Sort in ascending priority, we want to get the lowest module and nomodule targets
                  .sort(
                    (manifestA, manifestB) =>
                      (manifestB.metadata.priority ?? 0) -
                      (manifestA.metadata.priority ?? 0),
                  );

                const defaultManifest = manifests[0];
                const moduleManifest = manifests.find(
                  (manifest) => manifest.metadata.modules,
                );
                const noModuleManifest =
                  defaultManifest === moduleManifest
                    ? undefined
                    : defaultManifest;

                const manifestToCode = (manifest?: AssetBuild) =>
                  manifest == null
                    ? 'undefined'
                    : `JSON.parse(${JSON.stringify(JSON.stringify(manifest))})`;

                return stripIndent`
                  import {createAssetManifest} from '@quilted/quilt/server';

                  export default function createManifest() {
                    const noModuleManifest = ${manifestToCode(
                      noModuleManifest,
                    )};
                    const moduleManifest = ${manifestToCode(moduleManifest)};

                    return createAssetManifest({
                      getBuild({modules}) {
                        if (modules) {
                          if (moduleManifest) return moduleManifest;
  
                          return {
                            metadata: {modules: true},
                            async: {},
                            entry: {scripts: [], styles: []},
                          };
                        }
  
                        if (noModuleManifest) return noModuleManifest;
  
                        return {
                          metadata: {modules: false},
                          async: {},
                          entry: {scripts: [], styles: []},
                        };
                      },
                    });
                  }
                `;
              },
            });

            plugins.push({
              name: '@quilted/magic-app-static-entry',
              resolveId(id) {
                if (id === MAGIC_ENTRY_MODULE) {
                  // We resolve to a path within the project’s directory
                  // so that it can use the app’s node_modules.
                  return {
                    id: project.fs.resolvePath(id),
                    moduleSideEffects: 'no-treeshake',
                  };
                }

                return null;
              },
              load(source) {
                if (source !== project.fs.resolvePath(MAGIC_ENTRY_MODULE)) {
                  return null;
                }

                return stripIndent`
                  import App from ${JSON.stringify(MAGIC_MODULE_APP_COMPONENT)};
                  import assets from ${JSON.stringify(
                    MAGIC_MODULE_APP_ASSET_MANIFEST,
                  )};
                  import {renderStatic} from '@quilted/quilt/static';

                  export default async function render(options) {
                    await renderStatic(App, {assets, ...options});
                  }
                `;
              },
            });

            return plugins;
          });

          rollupOutputs?.(async (outputs) => {
            outputs.push({
              format: 'esm',
              entryFileNames: outputFilename,
              dir: nodeScriptOutputDirectory,
            });

            return outputs;
          });
        },
      );

      run((step, {configuration}) =>
        step({
          name: 'Quilt.App.Static',
          label: `Build static outputs for app ${project.name}`,
          needs: (step) => {
            return {
              need: step.target === project && step.name === STEP_NAME,
              allowSkip: true,
            };
          },
          async run() {
            await rm(nodeScriptOutputDirectory, {
              force: true,
              recursive: true,
            });

            const [configure, {buildWithRollup}] = await Promise.all([
              configuration({
                quiltAppStatic: true,
              }),
              import('../tools/rollup'),
            ]);

            await buildWithRollup(project, configure);

            const {
              outputDirectory,
              quiltStaticBuildRoutes,
              quiltStaticBuildCrawl,
              quiltStaticBuildPrettify,
              quiltStaticBuildWriteRoute,
            } = configure;

            const [routes, crawl, prettify, outputRoot] = await Promise.all([
              quiltStaticBuildRoutes!.run(),
              quiltStaticBuildCrawl!.run(),
              quiltStaticBuildPrettify!.run(),
              outputDirectory.run(project.fs.buildPath()),
            ]);

            const {default: renderStatic} = await (import(
              outputFile
            ) as Promise<{
              default: (
                options: Omit<StaticRenderOptions, 'assets'>,
              ) => Promise<void>;
            }>);

            await renderStatic({
              routes,
              crawl,
              prettify,
              async onRender({route, hasChildren, content, fallback, http}) {
                let defaultValue: string | false = false;

                if (!fallback || (route === '/' && http.statusCode === 404)) {
                  const normalizedRoute = route.replace(/^[/]/, '');
                  const filename = fallback ? '404.html' : 'index.html';
                  defaultValue =
                    normalizedRoute === '' || fallback || hasChildren
                      ? path.join(normalizedRoute, filename)
                      : `${normalizedRoute}.html`;
                }

                const finalFilename = await quiltStaticBuildWriteRoute!.run(
                  defaultValue,
                  {route, fallback, hasChildren, http},
                );

                if (!finalFilename) return;

                await project.fs.write(
                  path.join(outputRoot, 'public', finalFilename),
                  content,
                );
              },
            });
          },
        }),
      );
    },
  });
}
