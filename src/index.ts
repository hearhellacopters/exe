import { readFileSync, writeFileSync } from 'fs';
import type { WriteFileOptions } from 'fs';
import { exec } from '@yao-pkg/pkg';
import { type ResEdit, load } from 'resedit/cjs';
import { VersionStringValues } from 'resedit/dist/resource';
import type { Options } from './Options';

// Language code for en-us and encoding codepage for UTF-16
const language = {
    lang: 1033, // en-us
    codepage: 1200 // UTF-16
};

/**
 * Waits for resourcse to be free
 * @param {string} filePath  Path to file
 * @param {Buffer} data data to write
 * @param {WriteFileOptions?} options WriteFileOptions
 * @param {number} maxRetries max retries
 * @param {number} delayMs delays in mili-seconds
 */
function writeFileWithRetry(
    filePath: string = '',
    data: Buffer = Buffer.alloc(1),
    options: WriteFileOptions | null = {},
    maxRetries: number = 5,
    delayMs: number = 1000
) {
    let attempts = 0;

    while (attempts < maxRetries) {
        try {
            writeFileSync(filePath, data, options);
            // console.log(`File written successfully after ${attempts + 1} attempt(s).`);
            return;
        } catch (err) {
            // @ts-ignore
            if (err.code === 'EBUSY') {
                attempts++;
                console.log(`Build file is EBUSY after ${attempts} failed attempt. Retrying in ${delayMs}ms...`);
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
            } else {
                console.error('Error writing file:', err);
                throw err; // Rethrow for non-EBUSY errors
            }
        }
    }

    throw new Error(`Failed to write file after ${maxRetries} attempts.`);
}

/**
 * Build an executable
 * @param {Options} options
 * @returns An empty promise which is resolved when the executable is built
 */
async function exe(options: Options): Promise<void> {
    const RE: typeof ResEdit = await load();
    const args = [options.entry, ...(options.pkg || []), '-t', options.target || 'latest-win-x64', '-o', options.out];

    // Build w/ PKG
    await exec(args);

    // Modify .exe w/ ResEdit
    const data = readFileSync(options.out);
    const executable = RE.NtExecutable.from(data);
    const res = RE.NtExecutableResource.from(executable);
    const vi = RE.Resource.VersionInfo.fromEntries(res.entries)[0];

    // Remove original filename
    vi.removeStringValue(language, 'OriginalFilename');
    vi.removeStringValue(language, 'InternalName');

    // Product version
    if (options.version) {
        // Convert version to tuple of 3 numbers
        const version = options.version
            .split('.')
            .map(v => Number(v) || 0)
            .slice(0, 3) as [number, number, number];

        // Update versions
        vi.setProductVersion(...version, 0, language.lang);
        vi.setFileVersion(...version, 0, language.lang);
    }

    // Add additional user specified properties
    if (options.properties) {
        vi.setStringValues(language, options.properties as unknown as VersionStringValues);
    }

    vi.outputToResourceEntries(res.entries);

    // Add icon
    if (options.icon) {
        const iconFile = RE.Data.IconFile.from(readFileSync(options.icon));
        RE.Resource.IconGroupEntry.replaceIconsForResource(
            res.entries,
            1,
            language.lang,
            iconFile.icons.map(item => item.data)
        );
    }

    // Execution level
    const level = options.executionLevel || 'asInvoker';
    const manifest = res.getResourceEntriesAsString(24, 1)[0][1];
    res.replaceResourceEntryFromString(24, 1, language.lang, manifest.replace('asInvoker', level));

    // Regenerate and write to .exe
    res.outputResource(executable);
    writeFileWithRetry(options.out, Buffer.from(executable.generate()));
}

export = exe;
