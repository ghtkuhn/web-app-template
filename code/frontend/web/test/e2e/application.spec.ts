import { expect, test } from '@playwright/test';

const presentations = [
    { name: 'Mobile presentation', width: 390, height: 844 },
    { name: 'Tablet presentation', width: 900, height: 1000 },
    { name: 'Desktop presentation', width: 1440, height: 900 },
];

for (const presentation of presentations) {
    test(`${presentation.name} renders routes and Health`, async ({ page }) => {
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
        await expect(page.getByText(presentation.name)).toBeVisible();
        await page
            .getByRole('button', { name: /(health|backend)/i })
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
        await page.goto('/sign-up');
        await expect(
            page.getByText('Registration is not available for this deployment.'),
        ).toBeVisible();
        await page.goto('/account');
        await expect(page).toHaveURL(/\/sign-in$/u);
    });
}
