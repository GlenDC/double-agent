import IDetectionPlugin from '@double-agent/runner/interfaces/IDetectionPlugin';
import IRequestContext from '@double-agent/runner/interfaces/IRequestContext';
import trackRemoteTcpVars from './lib/trackRemoteTcpVars';
import IDetectionDomains from '@double-agent/runner/interfaces/IDetectionDomains';
import TcpProfile from './lib/TcpProfile';
import { lookup } from 'useragent';
import IFlaggedCheck from '@double-agent/runner/interfaces/IFlaggedCheck';
import IAsset from '@double-agent/runner/interfaces/IAsset';

export default class TcpPlugin implements IDetectionPlugin {
  private getRemoteTcpVarsForAddress: (
    remoteAddress: string,
  ) => Promise<{ windowSize: number; ttl: number }>;
  private closeTracker: () => void;

  public async start(domains: IDetectionDomains, secureDomains: IDetectionDomains): Promise<void> {
    const tracker = trackRemoteTcpVars(domains.main.port, secureDomains.main.port);
    this.getRemoteTcpVarsForAddress = tracker.getPacket;
    this.closeTracker = tracker.stop;
  }

  public async stop() {
    this.closeTracker();
  }

  public async onRequest(ctx: IRequestContext) {
    if (ctx.session.requests.length > 1) {
      return;
    }
    const packet = await this.getRemoteTcpVarsForAddress(ctx.requestDetails.remoteAddress);
    const profile = new TcpProfile(ctx.requestDetails.useragent, packet.ttl, packet.windowSize);
    await profile.save();

    const ua = lookup(ctx.requestDetails.useragent);
    let expectedOsWindowSizes = expectedWindowSizes[ua.os.family];
    if (ua.os.family === 'Windows') {
      expectedOsWindowSizes =
        expectedWindowSizes[Number(ua.os.major) >= 10 ? 'Windows10' : 'Windows7'];
    }
    const expectedOsTtl = expectedTtlValues[ua.os.family];

    const { windowSize, ttl } = packet;
    // allow some leeway for router hops that decrement ttls
    const ttlDiff = expectedOsTtl - ttl;

    const entry = {
      originType: ctx.requestDetails.originType,
      hostDomain: ctx.requestDetails.hostDomain,
      resourceType: ctx.requestDetails.resourceType,
      layer: 'tcp',
      requestIdx: ctx.session.requests.indexOf(ctx.requestDetails),
      secureDomain: ctx.requestDetails.secureDomain,
    } as IAsset;

    const ttlCheck = {
      ...entry,
      category: 'TCP Layer',
      checkName: 'Packet TTL',
      description:
        'Check that the Operating System tcp packet TTL value matches expected OS values (NOTE: tcp packets routed through proxies can change these values)',
      value: ttlDiff,
    };

    if (ttlDiff > TcpProfile.allowedHops && ttlDiff >= 0) {
      ctx.session.flaggedChecks.push({
        ...ttlCheck,
        pctBot: 50,
        expected: expectedOsTtl,
      });
    }

    const windowCheck = {
      ...entry,
      checkName: 'Packet WindowSize',
      description:
        'Check that the Operating System tcp packet window size value matches expected OS values (NOTE: tcp packets routed through proxies can change these values)',
      value: ttlDiff,
    } as IFlaggedCheck;

    if (!expectedOsWindowSizes.includes(windowSize)) {
      ctx.session.flaggedChecks.push({
        ...windowCheck,
        pctBot: 50,
        expected: expectedOsWindowSizes.join(','),
      });
    }
    ctx.session.pluginsRun.push(`tcp/ttl`);
  }
}

const expectedTtlValues = {
  'Mac OS X': 64,
  Linux: 64,
  Windows: 128,
};

const expectedWindowSizes = {
  'Mac OS X': [65535],
  Linux: [5840, 29200, 5720],
  Windows7: [8192],
  Windows10: [64240, 65535],
};
