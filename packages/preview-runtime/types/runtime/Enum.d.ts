export interface PreviewEnumItem {
    readonly [key: string]: unknown;
    readonly EnumType: PreviewEnumCategory;
    readonly Name: string;
    readonly Value: number;
    IsA(name: string): boolean;
}
export interface PreviewEnumCategory {
    readonly [key: string]: unknown;
    readonly Name: string;
    GetEnumItems(): PreviewEnumItem[];
    FromName(name: string): PreviewEnumItem;
    FromValue(value: number): PreviewEnumItem;
}
export interface PreviewEnumRoot {
    readonly [key: string]: unknown;
    GetEnums(): PreviewEnumCategory[];
}
export declare const Enum: PreviewEnumRoot;
export default Enum;
