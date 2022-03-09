import {createProjectPlugin} from '@quilted/sewing-kit';
import type {App} from '@quilted/sewing-kit';
import type {Plugin} from 'rollup';

import {MAGIC_MODULE_APP_COMPONENT} from '../constants';

export function magicModuleApp() {
  return createProjectPlugin<App>({
    name: 'Quilt.MagicModule.App',
    build({project, configure}) {
      configure(({rollupPlugins}) => {
        rollupPlugins?.((plugins) => {
          return [rollupPlugin(project), ...plugins];
        });
      });
    },
    develop({project, configure}) {
      configure(({vitePlugins}) => {
        vitePlugins?.((plugins) => {
          return [{...rollupPlugin(project), enforce: 'pre'}, ...plugins];
        });
      });
    },
  });
}

function rollupPlugin(project: App): Plugin {
  return {
    name: '@quilted/magic-module/app',
    async resolveId(id) {
      if (id === MAGIC_MODULE_APP_COMPONENT) return id;

      return null;
    },
    load(source) {
      if (source === MAGIC_MODULE_APP_COMPONENT) {
        return `export {default} from ${JSON.stringify(
          project.fs.resolvePath(project.entry ?? 'index'),
        )}`;
      }
    },
  };
}
