import { invoke } from "@tauri-apps/api/core";

export interface FileStorageError {
    key: string;
    operation: "read" | "write" | "delete" | "list" | "exists";
    message: string;
}

export class FileStorage {
    static read<T>(key: string): T | null {
        try {
            const value = invoke<unknown>("file_storage_read", { key });
            if (value === null) {
                return null;
            }
            return value as T;
        } catch (error) {
            console.error(`[FileStorage] Failed to read key '${key}':`, error);
            throw {
                key,
                operation: "read" as const,
                message: String(error),
            } satisfies FileStorageError;
        }
    }

    static write<T>(key: string, value: T): void {
        try {
            invoke("file_storage_write", { key, value });
        } catch (error) {
            console.error(`[FileStorage] Failed to write key '${key}':`, error);
            throw {
                key,
                operation: "write" as const,
                message: String(error),
            } satisfies FileStorageError;
        }
    }

    static delete(key: string): void {
        try {
            invoke("file_storage_delete", { key });
        } catch (error) {
            console.error(`[FileStorage] Failed to delete key '${key}':`, error);
            throw {
                key,
                operation: "delete" as const,
                message: String(error),
            } satisfies FileStorageError;
        }
    }

    // static list(): string[] {
    //     try {
    //         return invoke<string[]>("file_storage_list");
    //     } catch (error) {
    //         console.error("[FileStorage] Failed to list keys:", error);
    //         throw {
    //             key: "",
    //             operation: "list" as const,
    //             message: String(error),
    //         } satisfies FileStorageError;
    //     }
    // }

    // static exists(key: string): boolean {
    //     try {
    //         return invoke<boolean>("file_storage_exists", { key });
    //     } catch (error) {
    //         console.error(`[FileStorage] Failed to check existence of key '${key}':`, error);
    //         throw {
    //             key,
    //             operation: "exists" as const,
    //             message: String(error),
    //         } satisfies FileStorageError;
    //     }
    // }
}

// export const LOCAL_STORAGE_MIGRATION_COMPLETE_KEY = "mvp-calendar-migration-complete";

// export async function migrateLocalStorageToFileStorage(): Promise<{
//     success: boolean;
//     migratedKeys: string[];
//     errors: FileStorageError[];
// }> {
//     const migratedKeys: string[] = [];
//     const errors: FileStorageError[] = [];

//     const migrationComplete = localStorage.getItem(LOCAL_STORAGE_MIGRATION_COMPLETE_KEY);
//     if (migrationComplete === "true") {
//         return { success: true, migratedKeys: [], errors: [] };
//     }

//     const keysToMigrate = [
//         "mvp-calendar-tasks",
//         "mvp-calendar-task-types",
//         "mvp-calendar-task-type-colors",
//         "mvp-calendar-google-event-task-map",
//     ];

//     for (const key of keysToMigrate) {
//         const rawValue = localStorage.getItem(key);
//         if (rawValue === null) {
//             continue;
//         }

//         try {
//             const parsedValue = JSON.parse(rawValue);
//             await FileStorage.write(key, parsedValue);
//             migratedKeys.push(key);
//         } catch (error) {
//             const fileError: FileStorageError = {
//                 key,
//                 operation: "write",
//                 message: `Migration failed: ${error}`,
//             };
//             errors.push(fileError);
//             console.error(`[Migration] Failed to migrate key '${key}':`, error);
//         }
//     }

//     if (errors.length === 0) {
//         localStorage.setItem(LOCAL_STORAGE_MIGRATION_COMPLETE_KEY, "true");
//     }

//     return {
//         success: errors.length === 0,
//         migratedKeys,
//         errors,
//     };
// }

// export function clearLocalStorageData(): void {
//     const keysToClear = [
//         "mvp-calendar-tasks",
//         "mvp-calendar-task-types",
//         "mvp-calendar-task-type-colors",
//         "mvp-calendar-google-event-task-map",
//         LOCAL_STORAGE_MIGRATION_COMPLETE_KEY,
//     ];

//     for (const key of keysToClear) {
//         localStorage.removeItem(key);
//     }
// }
