export type UniversalRobloxMock = ((
	...args: unknown[]
) => UniversalRobloxMock) &
	(new (
		...args: unknown[]
	) => UniversalRobloxMock) & {
		[key: string]: UniversalRobloxMock;
		[key: number]: UniversalRobloxMock;
	};
export interface UniversalRobloxModuleMock {
	readonly default: UniversalRobloxMock;
	readonly [key: string]: UniversalRobloxMock;
	readonly [key: number]: UniversalRobloxMock;
}
export declare function createUniversalRobloxMock(): UniversalRobloxMock;
export declare function createUniversalRobloxModuleMock(): UniversalRobloxModuleMock;
export declare const robloxMock: UniversalRobloxMock;
export declare const robloxModuleMock: UniversalRobloxModuleMock;
export default robloxMock;
