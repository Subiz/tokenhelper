let index = require('./index.js')

class TokenMock {
	A (transition, str) {
		transition('B', str)
	}

	B (transition, param) {
		if (param !== 'van') transition('x', 'should be 4')
		else transition('C', undefined, 100)
	}

	C (transition) {
		transition('exit', 'ok')
	}
}

test('run', async () => {
	let token = new TokenMock()
	let out = await index.run(token, 'A', 'thanh')
	expect(out).toContain('should be 4')

	out = await index.run(token, 'A', 'van')
	expect(out).toContain('ok')
})

test('loop', async () => {
	let i = 0
	let err = await index.loop4ever(resolve => {
		i++
		if (i < 10) {
			resolve(1)
			return
		}

		resolve(0, 'err44')
	})
	expect(err).toBe('err44')
})
