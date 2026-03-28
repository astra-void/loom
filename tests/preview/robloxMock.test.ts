// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { robloxMock } from '@loom-dev/preview-runtime';

describe('roblox mock instance', () => {
	it('uses a non-null root parent sentinel', () => {
		expect(robloxMock.Parent).not.toBeNull();
		expect(robloxMock.Parent?.Parent).toBeUndefined();
	});

	it('defers property-changed signal callbacks', async () => {
		const signal = robloxMock.GetPropertyChangedSignal('Parent');
		const callback = vi.fn();

		const connection = signal.Connect(callback);
		expect(callback).not.toHaveBeenCalled();

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(callback).toHaveBeenCalledTimes(1);

		connection.Disconnect();
	});
});
