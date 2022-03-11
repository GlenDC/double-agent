import * as Fs from 'fs';
import ProbesGenerator from '@double-agent/config/lib/ProbesGenerator';
import Config from '@double-agent/config';

async function extractFoundationalProbes(profilesDir: string, probesDir: string) {
    if (!(await Fs.exists(probesDir))) {
        await Fs.mkdir(probesDir, { recursive: true });
    }

    Config.probesDataDir = probesDir;
    const probesGenerator = new ProbesGenerator(profilesDir);
    await probesGenerator.run();
    await probesGenerator.save();
}

export {
    extractFoundationalProbes,
};
