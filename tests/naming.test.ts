import { expect, test } from 'claude-code/testing'

import { commandKey, shortName } from '../hooks/register'

test('runs of one module are named by the flag that sets them apart', () => {
  const run = 'python -m app.run --headless'
  expect(shortName(`${run} --bot fast --verbose`)).toBe('app.run-fast')
  expect(shortName(`${run} --model runs\\exp1\\best.zip`)).toBe('app.run-exp1-best')
  expect(shortName(`${run} --model runs\\exp1\\checkpoints\\step_5000.zip`)).toBe('app.run-step_5000')
  expect(shortName(`${run} --port 8080`)).toBe('app.run')
  expect(shortName('powershell -ExecutionPolicy Bypass -File scripts\\start_server.ps1')).toBe('start_server')
  expect(shortName('.venv\\Scripts\\python scripts\\logger.py')).toBe('logger')
})

test('slash and spacing variants are one command', () => {
  expect(commandKey('.venv/Scripts/python scripts/logger.py')).toBe(
    commandKey('.venv\\Scripts\\python  scripts\\logger.py'),
  )
  expect(commandKey('python a.py')).not.toBe(commandKey('python b.py'))
})
