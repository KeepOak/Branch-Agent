import { registerHooks } from 'node:module';
registerHooks({resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('./') && specifier.endsWith('.js') && context.parentURL?.includes('/src/media/ppt-geometry/')) {
    return nextResolve(specifier.slice(0, -3) + '.ts', context);
  }
  return nextResolve(specifier, context);
}});
