export interface MockInstanceLike {
    ClassName?: string;
    IsA?(name: string): boolean;
    Parent: MockInstanceLike | undefined;
}
export declare function getMockParent(value: unknown): MockInstanceLike | undefined;
export declare function findMockAncestor(value: unknown, predicate: (ancestor: MockInstanceLike) => boolean): MockInstanceLike | undefined;
export declare function findMockAncestorWhichIsA(value: unknown, className: string): MockInstanceLike | undefined;
export declare function findMockAncestorOfClass(value: unknown, className: string): MockInstanceLike | undefined;
