// OpenTubeX's application keys use a private hive. All Windows-owned registry
// paths retain their normal behavior, including proxy and certificate settings.
#include "registry.h"
#include <windows.h>
#include <winternl.h>
#include <MinHook.h>
#include <algorithm>
#include <cwctype>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
constexpr NTSTATUS Denied = static_cast<NTSTATUS>(0xC0000022L);
constexpr NTSTATUS Unsupported = static_cast<NTSTATUS>(0xC00000BBL);
HKEY hive = nullptr;
std::wstring hivePath;
std::wstring userPath;
using Open = NTSTATUS(NTAPI*)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES);
using OpenEx = NTSTATUS(NTAPI*)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, ULONG);
using Create = NTSTATUS(NTAPI*)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, ULONG, PUNICODE_STRING, ULONG, PULONG);
using Query = NTSTATUS(NTAPI*)(HANDLE, int, PVOID, ULONG, PULONG);
using SetValue = NTSTATUS(NTAPI*)(HANDLE, PUNICODE_STRING, ULONG, ULONG, PVOID, ULONG);
using DeleteValue = NTSTATUS(NTAPI*)(HANDLE, PUNICODE_STRING);
using KeyOperation = NTSTATUS(NTAPI*)(HANDLE);
using SetInformation = NTSTATUS(NTAPI*)(HANDLE, int, PVOID, ULONG);
using SetSecurity = NTSTATUS(NTAPI*)(HANDLE, SECURITY_INFORMATION, PSECURITY_DESCRIPTOR);
using Rename = NTSTATUS(NTAPI*)(HANDLE, PUNICODE_STRING);
using OpenTransacted = NTSTATUS(NTAPI*)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, HANDLE);
using OpenTransactedEx = NTSTATUS(NTAPI*)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, ULONG, HANDLE);
using CreateTransacted = NTSTATUS(NTAPI*)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, ULONG, PUNICODE_STRING, ULONG, HANDLE, PULONG);
Open originalOpen;
OpenEx originalOpenEx;
Create originalCreate;
Query query;
SetValue originalSetValue;
DeleteValue originalDeleteValue;
KeyOperation originalDelete, originalFlush;
SetInformation originalSetInformation;
SetSecurity originalSetSecurity;
Rename originalRename;
OpenTransacted originalOpenTransacted;
OpenTransactedEx originalOpenTransactedEx;
CreateTransacted originalCreateTransacted;

std::wstring Upper(std::wstring value)
{
    std::transform(value.begin(), value.end(), value.begin(), towupper);
    return value;
}

bool Below(const std::wstring& path, const std::wstring& root)
{
    return !root.empty() && path.compare(0, root.size(), root) == 0 &&
        (path.size() == root.size() || path[root.size()] == L'\\');
}

std::wstring KeyPath(HANDLE key)
{
    ULONG size = 0;
    query(key, 3 /* KeyNameInformation */, nullptr, 0, &size);
    if (size < sizeof(ULONG)) return {};
    std::vector<BYTE> data(size);
    if (query(key, 3, data.data(), size, &size) < 0) return {};
    ULONG bytes = *reinterpret_cast<ULONG*>(data.data());
    if (bytes > data.size() - sizeof(ULONG)) return {};
    return Upper(std::wstring(reinterpret_cast<wchar_t*>(data.data() + sizeof(ULONG)), bytes / sizeof(wchar_t)));
}

std::wstring ObjectPath(POBJECT_ATTRIBUTES attributes)
{
    if (!attributes || !attributes->ObjectName || !attributes->ObjectName->Buffer) return {};
    std::wstring name(attributes->ObjectName->Buffer, attributes->ObjectName->Length / sizeof(wchar_t));
    if (attributes->RootDirectory) {
        auto parent = KeyPath(attributes->RootDirectory);
        if (parent.empty()) return {};
        name = parent + (name.empty() ? L"" : L"\\") + name;
    }
    return Upper(name);
}

bool ApplicationComponent(const std::wstring& component)
{
    return component == L"OPENTUBEX" || component == L"ELECTRON.APP.OPENTUBEX" ||
        component == L"IO.OPENTUBEX.OPENTUBEX";
}

// Match entire application-name components, never e.g. OpenTubeXOther.
// Current-user paths are stored without the machine-specific SID.
std::wstring ApplicationPath(const std::wstring& path)
{
    if (Below(path, hivePath)) return {};
    std::wstring logical;
    if (Below(path, userPath + L"_CLASSES"))
        logical = L"USER\\SOFTWARE\\CLASSES" + path.substr(userPath.size() + 8);
    else if (Below(path, userPath))
        logical = L"USER" + path.substr(userPath.size());
    else if (Below(path, L"\\REGISTRY\\MACHINE"))
        logical = L"MACHINE" + path.substr(17);
    else return {};
    if (!Below(logical, L"USER\\SOFTWARE") && !Below(logical, L"MACHINE\\SOFTWARE")) return {};
    size_t start = 0;
    while (start < logical.size()) {
        size_t end = logical.find(L'\\', start);
        auto component = logical.substr(start, end - start);
        if (ApplicationComponent(component)) return logical;
        if (end == std::wstring::npos) break;
        start = end + 1;
    }
    return {};
}

bool HostApplicationKey(HANDLE key) { return !ApplicationPath(KeyPath(key)).empty(); }

struct Redirect {
    std::wstring path;
    UNICODE_STRING name{};
    OBJECT_ATTRIBUTES attributes{};
    NTSTATUS status = 0;
    Redirect(POBJECT_ATTRIBUTES source, ACCESS_MASK access) : path(ApplicationPath(ObjectPath(source)))
    {
        if (path.empty()) return;
        // Resolve the host parent read-only through Windows, which knows which
        // WOW64 keys are shared and which redirect to a different physical path.
        // Never open the application key itself on the host.
        auto host = ObjectPath(source);
        size_t start = 0;
        while (start < host.size()) {
            size_t end = host.find(L'\\', start);
            if (ApplicationComponent(host.substr(start, end - start))) break;
            if (end == std::wstring::npos) return;
            start = end + 1;
        }
        std::wstring parentPath = host.substr(0, start - 1);
        UNICODE_STRING parentName{};
        parentName.Buffer = parentPath.data();
        parentName.Length = static_cast<USHORT>(parentPath.size() * sizeof(wchar_t));
        parentName.MaximumLength = parentName.Length;
        OBJECT_ATTRIBUTES parentAttributes{};
        InitializeObjectAttributes(&parentAttributes, &parentName, OBJ_CASE_INSENSITIVE, nullptr, nullptr);
        HANDLE parent;
        status = originalOpenEx(&parent, KEY_READ | (access & (KEY_WOW64_32KEY | KEY_WOW64_64KEY)), &parentAttributes, 0);
        if (status < 0) return;
        auto canonicalParent = KeyPath(parent);
        RegCloseKey(static_cast<HKEY>(parent));
        if (canonicalParent.empty()) { status = Denied; return; }
        path = ApplicationPath(canonicalParent + host.substr(start - 1));
        if (path.empty() || path.size() * sizeof(wchar_t) > 0xffff) { status = Denied; return; }
        name.Buffer = path.data();
        name.Length = static_cast<USHORT>(path.size() * sizeof(wchar_t));
        name.MaximumLength = name.Length;
        attributes = *source;
        attributes.RootDirectory = hive;
        attributes.ObjectName = &name;
        // Private hives have one security descriptor; host ACLs are not copied.
        attributes.SecurityDescriptor = nullptr;
    }
};

NTSTATUS NTAPI OpenKey(PHANDLE result, ACCESS_MASK access, POBJECT_ATTRIBUTES attributes)
{
    Redirect local(attributes, access);
    if (local.status < 0) return local.status;
    return originalOpen(result, access, local.path.empty() ? attributes : &local.attributes);
}
NTSTATUS NTAPI OpenKeyEx(PHANDLE result, ACCESS_MASK access, POBJECT_ATTRIBUTES attributes, ULONG options)
{
    Redirect local(attributes, access);
    if (local.status < 0) return local.status;
    return originalOpenEx(result, access, local.path.empty() ? attributes : &local.attributes, options);
}
NTSTATUS NTAPI CreateKey(PHANDLE result, ACCESS_MASK access, POBJECT_ATTRIBUTES attributes,
    ULONG title, PUNICODE_STRING className, ULONG options, PULONG disposition)
{
    Redirect local(attributes, access);
    if (local.status < 0) return local.status;
    if (local.path.empty()) return originalCreate(result, access, attributes, title, className, options, disposition);
    if (options & (REG_OPTION_CREATE_LINK | REG_OPTION_BACKUP_RESTORE)) return Unsupported;
    auto slash = local.path.find_last_of(L'\\');
    HKEY parent = nullptr;
    auto status = RegCreateKeyExW(hive, local.path.substr(0, slash).c_str(), 0, nullptr, 0,
        KEY_CREATE_SUB_KEY, nullptr, &parent, nullptr);
    if (status != ERROR_SUCCESS) return Denied;
    RegCloseKey(parent);
    return originalCreate(result, access, &local.attributes, title, className, options, disposition);
}

// Handles opened before injection must never mutate application state on the
// host. Redirected handles are real kernel handles, so reads, enumeration,
// duplication, deletion, notifications and sharing use native Windows behavior.
NTSTATUS NTAPI SetValueKey(HANDLE key, PUNICODE_STRING name, ULONG title, ULONG type, PVOID data, ULONG size)
{
    return HostApplicationKey(key) ? Denied : originalSetValue(key, name, title, type, data, size);
}
NTSTATUS NTAPI DeleteValueKey(HANDLE key, PUNICODE_STRING name)
{
    return HostApplicationKey(key) ? Denied : originalDeleteValue(key, name);
}
NTSTATUS NTAPI DeleteKey(HANDLE key) { return HostApplicationKey(key) ? Denied : originalDelete(key); }
NTSTATUS NTAPI FlushKey(HANDLE key) { return HostApplicationKey(key) ? Denied : originalFlush(key); }
NTSTATUS NTAPI SetInformationKey(HANDLE key, int kind, PVOID data, ULONG size)
{
    return HostApplicationKey(key) ? Denied : originalSetInformation(key, kind, data, size);
}
NTSTATUS NTAPI SetSecurityObject(HANDLE key, SECURITY_INFORMATION information, PSECURITY_DESCRIPTOR descriptor)
{
    return HostApplicationKey(key) ? Denied : originalSetSecurity(key, information, descriptor);
}
NTSTATUS NTAPI RenameKey(HANDLE key, PUNICODE_STRING name)
{
    auto path = KeyPath(key);
    if (HostApplicationKey(key)) return Denied;
    if (name && name->Buffer) {
        auto destination = path.substr(0, path.find_last_of(L'\\') + 1) +
            Upper(std::wstring(name->Buffer, name->Length / sizeof(wchar_t)));
        if (!ApplicationPath(destination).empty()) return Denied;
    }
    return originalRename(key, name);
}
NTSTATUS NTAPI OpenKeyTransacted(PHANDLE result, ACCESS_MASK access, POBJECT_ATTRIBUTES attributes, HANDLE transaction)
{
    return ApplicationPath(ObjectPath(attributes)).empty() ?
        originalOpenTransacted(result, access, attributes, transaction) : Unsupported;
}
NTSTATUS NTAPI OpenKeyTransactedEx(PHANDLE result, ACCESS_MASK access, POBJECT_ATTRIBUTES attributes, ULONG options, HANDLE transaction)
{
    return ApplicationPath(ObjectPath(attributes)).empty() ?
        originalOpenTransactedEx(result, access, attributes, options, transaction) : Unsupported;
}
NTSTATUS NTAPI CreateKeyTransacted(PHANDLE result, ACCESS_MASK access, POBJECT_ATTRIBUTES attributes,
    ULONG title, PUNICODE_STRING className, ULONG options, HANDLE transaction, PULONG disposition)
{
    return ApplicationPath(ObjectPath(attributes)).empty() ?
        originalCreateTransacted(result, access, attributes, title, className, options, transaction, disposition) : Unsupported;
}

template<typename T> void Hook(const char* name, T replacement, T& original)
{
    if (MH_CreateHookApi(L"ntdll", name, reinterpret_cast<LPVOID>(replacement),
        reinterpret_cast<LPVOID*>(&original)) != MH_OK) throw std::runtime_error("Registry hook installation failed");
}
} // namespace

void InstallRegistryHooks()
{
    query = reinterpret_cast<Query>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryKey"));
    if (!query) throw std::runtime_error("NtQueryKey unavailable");
    HKEY currentUser;
    if (RegOpenCurrentUser(KEY_READ, &currentUser) != ERROR_SUCCESS) throw std::runtime_error("Cannot resolve current user");
    userPath = KeyPath(currentUser);
    RegCloseKey(currentUser);
    if (userPath.empty()) throw std::runtime_error("Cannot resolve user registry path");
    HMODULE self;
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
        reinterpret_cast<LPCWSTR>(&InstallRegistryHooks), &self)) throw std::runtime_error("Cannot locate Interposer");
    wchar_t file[32768];
    DWORD length = GetModuleFileNameW(self, file, ARRAYSIZE(file));
    if (!length || length >= ARRAYSIZE(file)) throw std::runtime_error("Cannot locate portable directory");
    std::wstring directory(file, length);
    directory.resize(directory.find_last_of(L'\\') + 1);
    directory += L".interposer";
    if (!CreateDirectoryW(directory.c_str(), nullptr) && GetLastError() != ERROR_ALREADY_EXISTS)
        throw std::runtime_error("Cannot create portable registry directory");
    // Options=0 permits other OpenTubeX processes to load the same private hive.
    if (RegLoadAppKeyW((directory + L"\\Registry.hiv").c_str(), &hive, KEY_ALL_ACCESS, 0, 0) != ERROR_SUCCESS)
        throw std::runtime_error("Cannot load portable registry hive");
    hivePath = KeyPath(hive);
    if (hivePath.empty()) throw std::runtime_error("Cannot resolve portable hive");
    Hook("NtOpenKey", OpenKey, originalOpen);
    Hook("NtOpenKeyEx", OpenKeyEx, originalOpenEx);
    Hook("NtCreateKey", CreateKey, originalCreate);
    Hook("NtSetValueKey", SetValueKey, originalSetValue);
    Hook("NtDeleteValueKey", DeleteValueKey, originalDeleteValue);
    Hook("NtDeleteKey", DeleteKey, originalDelete);
    Hook("NtFlushKey", FlushKey, originalFlush);
    Hook("NtSetInformationKey", SetInformationKey, originalSetInformation);
    Hook("NtSetSecurityObject", SetSecurityObject, originalSetSecurity);
    Hook("NtRenameKey", RenameKey, originalRename);
    Hook("NtOpenKeyTransacted", OpenKeyTransacted, originalOpenTransacted);
    Hook("NtOpenKeyTransactedEx", OpenKeyTransactedEx, originalOpenTransactedEx);
    Hook("NtCreateKeyTransacted", CreateKeyTransacted, originalCreateTransacted);
}

void RemoveRegistryHooks()
{
    if (hive) { RegCloseKey(hive); hive = nullptr; }
}
