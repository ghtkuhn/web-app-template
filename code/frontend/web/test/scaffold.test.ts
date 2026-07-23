import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
    FrontendScaffold,
    type ScaffoldVerifier,
} from '../script/scaffold/scaffold.ts';

class Verifier implements ScaffoldVerifier {
    public shouldFail = false;

    public verify(): void {
        if (this.shouldFail) {
            throw new Error('verification failed');
        }
    }
}

const temporaryRoots: string[] = [];

function fixture(): {
    root: string;
    verifier: Verifier;
    scaffold: FrontendScaffold;
} {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-scaffold-'));
    temporaryRoots.push(root);
    fs.mkdirSync(path.join(root, 'src/app/routes'), { recursive: true });
    fs.writeFileSync(
        path.join(root, 'src/app/router.ts'),
        "import HomeRoute from './routes/HomeRoute.vue';\nconst router = {\n    routes: [\n    ],\n};\n",
    );
    const verifier = new Verifier();
    return {
        root,
        verifier,
        scaffold: new FrontendScaffold(root, verifier),
    };
}

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('route scaffold creates three views, adapter, and router entry', () => {
    const { root, scaffold } = fixture();
    expect(scaffold.run('route', ['user-profile'])).toBe(0);
    for (const presentation of ['desktop', 'tablet', 'mobile']) {
        expect(fs.existsSync(path.join(
            root,
            `src/presentation/${presentation}/views/UserProfileView.vue`,
        ))).toBe(true);
    }
    expect(fs.readFileSync(path.join(root, 'src/app/router.ts'), 'utf8'))
        .toContain("path: '/user-profile'");
});

test('component and feature scaffolds create exact architecture paths', () => {
    const { root, scaffold } = fixture();
    expect(scaffold.run('component', ['mobile', 'user-card'])).toBe(0);
    expect(scaffold.run('feature', ['user-profile'])).toBe(0);
    expect(fs.existsSync(path.join(
        root,
        'src/presentation/mobile/components/UserCard.vue',
    ))).toBe(true);
    expect(fs.existsSync(path.join(
        root,
        'src/core/services/user-profile.service.ts',
    ))).toBe(true);
});

test('invalid names, collisions, and verification failures are targeted', () => {
    const { root, verifier, scaffold } = fixture();
    expect(scaffold.run('feature', ['../escape'])).toBe(2);
    expect(scaffold.run('component', ['watch', 'card'])).toBe(2);
    expect(scaffold.run('feature', ['account'])).toBe(0);
    expect(scaffold.run('feature', ['account'])).toBe(2);

    verifier.shouldFail = true;
    expect(scaffold.run('component', ['desktop', 'temporary'])).toBe(2);
    expect(fs.existsSync(path.join(
        root,
        'src/presentation/desktop/components/Temporary.vue',
    ))).toBe(false);
});
