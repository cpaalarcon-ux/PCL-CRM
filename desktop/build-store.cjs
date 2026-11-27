const { build } = require('./package.json');
const workspace = require('./workspace.json');

const identityName = process.env.PCL_STORE_IDENTITY_NAME?.trim();
const publisher = process.env.PCL_STORE_PUBLISHER?.trim();
const publisherDisplayName = process.env.PCL_STORE_PUBLISHER_DISPLAY_NAME?.trim();

if (workspace.name !== 'production') throw Error('A Store package must use the production workspace.');
if (!/^[a-zA-Z0-9.-]{3,50}$/.test(identityName || '') || !publisher?.startsWith('CN=') || !publisherDisplayName) {
  throw Error('Enter the Package identity name, Publisher and Publisher display name from Partner Center.');
}

const { nsis, ...common } = build;
module.exports = {
  ...common,
  appId: 'com.pclnexus.offline',
  productName: 'PCL Nexus Offline',
  extraMetadata: { name: 'pcl-nexus-offline', version: '1.0.0' },
  directories: { buildResources: 'store-assets', output: 'dist-store' },
  win: { ...common.win, target: 'appx' },
  appx: { identityName, publisher, publisherDisplayName, applicationId: 'PCLNexusOffline' },
};
