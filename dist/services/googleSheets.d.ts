export declare class GoogleSheetsService {
    private sheets;
    private spreadsheetId?;
    private isConfigured;
    constructor();
    private initializeSheets;
    readSheet(sheetName: string): Promise<any[]>;
    writeSheet(sheetName: string, data: any[]): Promise<void>;
    appendToSheet(sheetName: string, data: any[]): Promise<void>;
    updateRow(sheetName: string, rowIndex: number, data: any): Promise<void>;
    clearSheet(sheetName: string): Promise<void>;
    deleteRow(sheetName: string, rowIndex: number): Promise<void>;
    private getSheetId;
    initializeDatabase(): Promise<void>;
    healthCheck(): Promise<boolean>;
}
export declare const googleSheetsService: GoogleSheetsService;
//# sourceMappingURL=googleSheets.d.ts.map