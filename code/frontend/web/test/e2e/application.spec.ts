import { expect, test } from '@playwright/test';

const presentations = [
    { name: 'Mobile presentation', width: 390, height: 844 },
    { name: 'Tablet presentation', width: 900, height: 1000 },
    { name: 'Desktop presentation', width: 1440, height: 900 },
];
const colorSchemes = ['light', 'dark'] as const;
const authRuntimeConfig = `window.__APP_CONFIG__ = ${JSON.stringify({
    apiBaseUrl: '/',
    webSocketUrl: 'ws://localhost:3001',
    presentationLock: null,
    authEnabled: true,
    registrationEnabled: true,
})};`;

for (const colorScheme of colorSchemes) {
    for (const presentation of presentations) {
        test(`${presentation.name} renders routes and Health in ${colorScheme} mode`, async ({ page }) => {
            await page.emulateMedia({ colorScheme });
            await page.setViewportSize({
                width: presentation.width,
                height: presentation.height,
            });
            await page.route('**/api/health', async (route) => {
                await route.fulfill({
                    contentType: 'application/json',
                    body: JSON.stringify({
                        success: true,
                        data: { status: 'ok' },
                    }),
                });
            });
            await page.goto('/');
            await expect(page.locator('html')).toHaveAttribute(
                'data-bs-theme',
                colorScheme,
            );
            await expect(page.getByText(presentation.name)).toBeVisible();
            await expect(page.locator('article.health-card')).toHaveClass(
                /\bcard\b/u,
            );
            await expect(
                page.getByRole('button', { name: /check health/i }),
            ).toHaveClass(/\bbtn-primary\b/u);
            await page
                .getByRole('button', { name: /check health/i })
                .click();
            await expect(page.getByText(/ok/i)).toBeVisible();
            await page.goto('/about');
            await expect(page.locator('h1')).toBeVisible();
            await page.goto('/missing');
            await expect(page.locator('h1')).toBeVisible();
            await page.goto('/sign-in');
            await expect(
                page.getByText('Authentication is disabled for this deployment.'),
            ).toBeVisible();
            await expect(
                page.getByText('Authentication is disabled for this deployment.'),
            ).toHaveClass(/\balert-secondary\b/u);
            await page.goto('/sign-up');
            await expect(
                page.getByText('Registration is not available for this deployment.'),
            ).toBeVisible();
            await page.goto('/account');
            await expect(page).toHaveURL(/\/sign-in$/u);
        });
    }
}

for (const presentation of presentations) {
    test(`${presentation.name} renders Bootstrap navigation, forms, and authentication errors`, async ({ page }) => {
        await page.setViewportSize({
            width: presentation.width,
            height: presentation.height,
        });
        await page.route('**/runtime-config.js', async (route) => {
            await route.fulfill({
                contentType: 'text/javascript',
                body: authRuntimeConfig,
            });
        });
        await page.route('**/api/auth/**', async (route) => {
            if (route.request().url().includes('get-session')) {
                await route.fulfill({
                    contentType: 'application/json',
                    body: 'null',
                });
                return;
            }
            await route.fulfill({
                status: 401,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Invalid credentials' }),
            });
        });

        await page.goto('/sign-in');
        await expect(page.locator('.navbar-brand')).toHaveCount(1);
        await expect(page.locator('nav .nav-link')).not.toHaveCount(0);
        await expect(page.getByLabel('Email')).toHaveClass(/\bform-control\b/u);
        await expect(page.getByLabel('Password')).toHaveClass(
            /\bform-control\b/u,
        );
        await expect(
            page.getByRole('button', { name: 'Sign in' }),
        ).toHaveClass(/\bbtn-primary\b/u);

        await page.getByLabel('Email').fill('person@example.com');
        await page.getByLabel('Password').fill('incorrect-password');
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(page.getByRole('alert')).toHaveClass(/\balert-danger\b/u);
        await expect(page.getByRole('alert')).toContainText(
            'Invalid credentials',
        );

        await page.goto('/sign-up');
        await expect(page.getByLabel('Name')).toHaveClass(/\bform-control\b/u);
        await expect(page.locator('.form-text')).toHaveCount(2);
        await expect(
            page.locator('.form-text').filter({ hasText: 'eight' }),
        ).toHaveClass(/\bform-text\b/u);
    });
}
