const { withStringsXml, withAndroidManifest } = require('expo/config-plugins');

const SITE = 'https://chat.hdsgroup.co.za';

/** Declares the site association so the site's getInstalledRelatedApps()
 *  can detect this app is installed (site side: assetlinks.json). */
const STATEMENT = JSON.stringify([
  { relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'web', site: SITE } },
]);

function setAssetStatement(strings) {
  const items = strings.resources.string || (strings.resources.string = []);
  const existing = items.find(s => s?.$?.name === 'asset_statements');
  if (existing) existing._ = STATEMENT;
  else items.push({ $: { name: 'asset_statements', translatable: 'false' }, _: STATEMENT });
  return strings;
}

function setManifestMeta(manifest) {
  const app = manifest.manifest.application[0];
  const items = app['meta-data'] || (app['meta-data'] = []);
  if (!items.some(m => m?.$?.['android:name'] === 'asset_statements')) {
    items.push({ $: { 'android:name': 'asset_statements', 'android:resource': '@string/asset_statements' } });
  }
  return manifest;
}

module.exports = function withAssetStatements(config) {
  config = withStringsXml(config, c => { setAssetStatement(c.modResults); return c; });
  config = withAndroidManifest(config, c => { setManifestMeta(c.modResults); return c; });
  return config;
};
