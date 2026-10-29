import { expect, test } from '@playwright/test'

test('mission control buttons execute the simulator lifecycle', async ({ page, request }) => {
  const missions = await request.get('http://127.0.0.1:8000/api/missions').then((response) => response.json())
  const mission = missions.find((item: { home_latitude_deg: number | null; home_longitude_deg: number | null }) =>
    item.home_latitude_deg !== null && item.home_longitude_deg !== null)
  expect(mission).toBeTruthy()
  await request.post(`http://127.0.0.1:8000/api/missions/${mission.id}/select`)
  await page.goto('/')

  const command = async (label: string, confirmation?: string) => {
    await page.getByRole('button', { name: label, exact: true }).click()
    if (confirmation) await expect(page.getByText(confirmation)).toBeVisible()
  }

  await command('RESET DEMO', 'RESET confirmed by simulator.')
  await command('STANDBY', 'STANDBY confirmed by simulator.')
  await command('RESET DEMO', 'RESET confirmed by simulator.')
  await command('UPLOAD', 'UPLOAD confirmed by simulator.')
  await command('START', 'START confirmed by simulator.')
  await command('PAUSE', 'PAUSE confirmed by simulator.')
  await command('RESUME', 'RESUME confirmed by simulator.')
  await command('REQUEST RTH', 'RTH confirmed by simulator.')
  await command('RESET DEMO', 'RESET confirmed by simulator.')
  await command('UPLOAD', 'UPLOAD confirmed by simulator.')
  await command('START', 'START confirmed by simulator.')

  page.once('dialog', (dialog) => dialog.accept())
  await command('ABORT MISSION', 'ABORT confirmed by simulator.')
})

test('fault injection updates notification toast, unread bell, and voice controls', async ({ page, request }) => {
  await request.delete('http://127.0.0.1:8000/api/simulation/faults')
  await page.goto('/')
  await page.getByRole('button', { name: 'ENABLE VOICE ALERTS', exact: true }).click()
  await expect(page.getByRole('button', { name: 'TEST VOICE', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'SIMULATE GNSS FAILURE', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('GNSS signal lost')
  await expect(page.locator('.notification-badge')).toBeVisible()
  await expect.poll(async () => (await request.get('http://127.0.0.1:8000/api/logs/records?event_type=fault')).json())
    .toMatchObject({ records: expect.arrayContaining([expect.objectContaining({ code: 'GNSS_DEGRADED' })]) })
})

test('Logs filters include mission lifecycle events and injected GNSS faults', async ({ page, request }) => {
  const missions = await request.get('http://127.0.0.1:8000/api/missions').then((response) => response.json())
  const mission = missions.find((item: { home_latitude_deg: number | null; home_longitude_deg: number | null }) =>
    item.home_latitude_deg !== null && item.home_longitude_deg !== null)
  expect(mission).toBeTruthy()
  const reset = await request.post(`http://127.0.0.1:8000/api/missions/${mission.id}/simulation-command`, {
    params: { command: 'reset', command_id: `logs-reset-${Date.now()}` },
  })
  expect(reset.ok()).toBeTruthy()
  const upload = await request.post(`http://127.0.0.1:8000/api/missions/${mission.id}/simulation-upload`, {
    params: { command_id: `logs-upload-${Date.now()}` },
  })
  expect(upload.ok()).toBeTruthy()
  const start = await request.post(`http://127.0.0.1:8000/api/missions/${mission.id}/simulation-command`, {
    params: { command: 'start', command_id: `logs-start-${Date.now()}` },
  })
  expect(start.ok()).toBeTruthy()
  await request.post('http://127.0.0.1:8000/api/simulation/faults', { params: { fault: 'gnss' } })

  await page.goto('/')
  await page.locator('.nav-item').filter({ hasText: 'Logs' }).dispatchEvent('click')
  await expect(page.getByText('Event Logs', { exact: true })).toBeVisible()
  await page.getByLabel('Event category').selectOption('Mission')
  await page.getByPlaceholder('message or fault code').fill('MISSION_START')
  await expect(page.locator('.logs-table')).toContainText('MISSION_START')
  await page.getByRole('button', { name: 'CLEAR FILTERS' }).click()
  await page.getByLabel('Event category').selectOption('Sensor')
  await page.getByLabel('Severity').selectOption('WARNING')
  await page.getByLabel('Data source').selectOption('simulation')
  await page.getByPlaceholder('message or fault code').fill('GNSS_DEGRADED')
  await expect(page.locator('.logs-table')).toContainText('GNSS_DEGRADED')
  await request.post(`http://127.0.0.1:8000/api/missions/${mission.id}/simulation-command`, {
    params: { command: 'abort', command_id: `logs-abort-${Date.now()}` },
  })
  await request.delete('http://127.0.0.1:8000/api/simulation/faults')
})
