#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <winhttp.h>
#include <winternl.h>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

static void Check(LSTATUS status, const char* operation)
{
    if (status != ERROR_SUCCESS)
        throw std::runtime_error(std::string(operation) + ": " + std::to_string(status));
}

static std::wstring Read(HKEY root, const std::wstring& path, const wchar_t* name)
{
    DWORD size = 0;
    Check(RegGetValueW(root, path.c_str(), name, RRF_RT_REG_SZ, nullptr, nullptr, &size), "query value size");
    std::vector<wchar_t> value(size / sizeof(wchar_t));
    Check(RegGetValueW(root, path.c_str(), name, RRF_RT_REG_SZ, nullptr, value.data(), &size), "read value");
    return std::wstring(value.data());
}

static void Write(const std::wstring& path, const wchar_t* name, const wchar_t* value)
{
    HKEY key;
    Check(RegCreateKeyExW(HKEY_CURRENT_USER, path.c_str(), 0, nullptr, 0,
        KEY_READ | KEY_WRITE, nullptr, &key, nullptr), "create/open key");
    LSTATUS status = RegSetValueExW(key, name, 0, REG_SZ,
        reinterpret_cast<const BYTE*>(value), static_cast<DWORD>((wcslen(value) + 1) * sizeof(wchar_t)));
    RegCloseKey(key);
    Check(status, "write value");
}

static void Require(bool condition, const char* description)
{
    if (!condition) throw std::runtime_error(description);
}

static void Child(const std::wstring& executable, const std::wstring& mode,
    const std::wstring& dll, const std::wstring& fixture)
{
    std::wstring command = L"\"" + executable + L"\" " + mode + L" \"" + dll + L"\" \"" + fixture + L"\"";
    STARTUPINFOW startup{ sizeof(startup) };
    PROCESS_INFORMATION process{};
    Require(CreateProcessW(nullptr, command.data(), nullptr, nullptr, FALSE, 0,
        nullptr, nullptr, &startup, &process), "start child");
    DWORD waited = WaitForSingleObject(process.hProcess, 30000);
    if (waited != WAIT_OBJECT_0) TerminateProcess(process.hProcess, 1);
    DWORD code = 1;
    GetExitCodeProcess(process.hProcess, &code);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    Require(waited == WAIT_OBJECT_0 && code == 0, "child registry check failed");
}

static void CheckRegistrySemantics(const std::wstring& fixture)
{
    HKEY key;
    Check(RegOpenKeyExW(HKEY_CURRENT_USER, fixture.c_str(), 0, KEY_READ, &key), "open read-only fixture");
    Require(RegSetValueExW(key, L"Denied", 0, REG_DWORD, nullptr, 0) == ERROR_ACCESS_DENIED,
        "read-only registry handle allowed a write");
    HKEY duplicate;
    Require(DuplicateHandle(GetCurrentProcess(), key, GetCurrentProcess(),
        reinterpret_cast<PHANDLE>(&duplicate), 0, FALSE, DUPLICATE_SAME_ACCESS), "duplicate registry handle");
    RegCloseKey(key);
    Require(Read(duplicate, L"", L"Original") == L"portable", "duplicated key lost its values");
    DWORD subkeys = 0, values = 0;
    Check(RegQueryInfoKeyW(duplicate, nullptr, nullptr, nullptr, &subkeys, nullptr, nullptr,
        &values, nullptr, nullptr, nullptr, nullptr), "query key information");
    Require(subkeys == 1 && values == 1, "enumeration includes host or deleted data");
    wchar_t name[256];
    DWORD size = 256;
    Check(RegEnumKeyExW(duplicate, 0, name, &size, nullptr, nullptr, nullptr, nullptr), "enumerate child");
    Require(_wcsicmp(name, L"LocalChild") == 0, "enumerated incorrect child");
    size = 256;
    Check(RegEnumValueW(duplicate, 0, name, &size, nullptr, nullptr, nullptr, nullptr), "enumerate value");
    Require(std::wstring(name) == L"Original", "enumerated incorrect value");
    using QueryValue = NTSTATUS(NTAPI*)(HANDLE, PUNICODE_STRING, int, PVOID, ULONG, PULONG);
    auto query = reinterpret_cast<QueryValue>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryValueKey"));
    wchar_t original[] = L"Original";
    UNICODE_STRING valueName{ sizeof(original) - sizeof(wchar_t), sizeof(original), original };
    ULONG needed = 0;
    Require(query(duplicate, &valueName, 2, nullptr, 0, &needed) < 0 && needed > 0, "native query did not report buffer size");
    std::vector<BYTE> data(needed);
    Require(query(duplicate, &valueName, 2, data.data(), needed, &needed) == 0, "native value query failed");
    RegCloseKey(duplicate);

    Write(fixture + L"\\DeletedTree\\Child", L"Value", L"old");
    Check(RegDeleteTreeW(HKEY_CURRENT_USER, (fixture + L"\\DeletedTree").c_str()), "delete local tree");
    Write(fixture + L"\\DeletedTree", L"Value", L"new");
    Require(RegOpenKeyExW(HKEY_CURRENT_USER, (fixture + L"\\DeletedTree\\Child").c_str(), 0, KEY_READ, &key)
        == ERROR_FILE_NOT_FOUND, "deleted child reappeared after recreating key");
    Check(RegDeleteTreeW(HKEY_CURRENT_USER, (fixture + L"\\DeletedTree").c_str()), "cleanup recreated key");
}

static void CheckRegistryViews()
{
    const wchar_t* path = L"Software\\Classes\\AppUserModelId\\electron.app.OpenTubeX\\RegistryRegression";
    HKEY key;
    Check(RegCreateKeyExW(HKEY_CURRENT_USER, path, 0, nullptr, 0,
        KEY_ALL_ACCESS | KEY_WOW64_32KEY, nullptr, &key, nullptr), "create shared Classes key in 32-bit view");
    const wchar_t value[] = L"shared";
    Check(RegSetValueExW(key, L"Value", 0, REG_SZ, reinterpret_cast<const BYTE*>(value), sizeof(value)), "write shared Classes value");
    RegCloseKey(key);
    Check(RegOpenKeyExW(HKEY_CURRENT_USER, path, 0, KEY_READ | KEY_WOW64_64KEY, &key), "open shared Classes key in 64-bit view");
    Require(Read(key, L"", L"Value") == L"shared", "Windows shared Classes value split between registry views");
    RegCloseKey(key);
    Check(RegDeleteTreeW(HKEY_CURRENT_USER, path), "cleanup shared Classes fixture");

    const wchar_t* machinePath = L"Software\\OpenTubeX\\RegistryRegression";
    for (REGSAM view : { KEY_WOW64_32KEY, KEY_WOW64_64KEY }) {
        Check(RegCreateKeyExW(HKEY_LOCAL_MACHINE, machinePath, 0, nullptr, 0,
            KEY_ALL_ACCESS | view, nullptr, &key, nullptr), "create machine key in selected view");
        const wchar_t* expected = view == KEY_WOW64_32KEY ? L"32" : L"64";
        Check(RegSetValueExW(key, L"Value", 0, REG_SZ, reinterpret_cast<const BYTE*>(expected),
            static_cast<DWORD>((wcslen(expected) + 1) * sizeof(wchar_t))), "write separate machine view");
        RegCloseKey(key);
    }
    for (REGSAM view : { KEY_WOW64_32KEY, KEY_WOW64_64KEY }) {
        Check(RegOpenKeyExW(HKEY_LOCAL_MACHINE, machinePath, 0, KEY_READ | view, &key), "open machine view");
        Require(Read(key, L"", L"Value") == (view == KEY_WOW64_32KEY ? L"32" : L"64"),
            "Windows separate machine views were merged");
        RegCloseKey(key);
    }
}

static void CheckHttps()
{
    HINTERNET session = WinHttpOpen(L"OpenTubeX registry regression", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    Require(session != nullptr, "open HTTPS session");
    WinHttpSetTimeouts(session, 15000, 15000, 15000, 15000);
    HINTERNET connection = WinHttpConnect(session, L"www.youtube.com", INTERNET_DEFAULT_HTTPS_PORT, 0);
    HINTERNET request = WinHttpOpenRequest(connection, L"GET", L"/robots.txt", nullptr,
        WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE);
    BOOL sent = WinHttpSendRequest(request, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
        WINHTTP_NO_REQUEST_DATA, 0, 0, 0);
    BOOL received = sent && WinHttpReceiveResponse(request, nullptr);
    DWORD status = 0, size = sizeof(status);
    BOOL queried = received && WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_HEADER_NAME_BY_INDEX, &status, &size, WINHTTP_NO_HEADER_INDEX);
    WinHttpCloseHandle(request);
    WinHttpCloseHandle(connection);
    WinHttpCloseHandle(session);
    Require(queried && status == 200, "verified YouTube HTTPS failed");
}

extern "C" int wmain(int argc, wchar_t** argv)
{
    try
    {
        Require(argc == 4, "usage: registry-tests MODE DLL FIXTURE-KEY");
        const std::wstring mode = argv[1], dll = argv[2], fixture = argv[3];
        if (mode == L"--host")
        {
            Require(Read(HKEY_CURRENT_USER, fixture, L"Original") == L"host", "overlay changed host value");
            Require(Read(HKEY_CURRENT_USER, fixture, L"Deleted") == L"keep on host", "overlay deleted host value");
            HKEY key = nullptr;
            LSTATUS status = RegOpenKeyExW(HKEY_CURRENT_USER, (fixture + L"\\LocalChild").c_str(), 0, KEY_READ, &key);
            if (key) RegCloseKey(key);
            Require(status == ERROR_FILE_NOT_FOUND, "overlay created a host key");
            for (REGSAM view : { KEY_WOW64_32KEY, KEY_WOW64_64KEY }) {
                key = nullptr;
                status = RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"Software\\OpenTubeX\\RegistryRegression", 0, KEY_READ | view, &key);
                if (key) RegCloseKey(key);
                Require(status == ERROR_FILE_NOT_FOUND, "portable machine view wrote to the host");
            }
            return 0;
        }
        if (mode == L"--remove-parent")
        {
            Check(RegDeleteTreeW(HKEY_CURRENT_USER, L"Software\\OpenTubeXRegressionContainer"), "remove host parent");
            return 0;
        }
        if (mode == L"--cleanup")
        {
            Check(RegDeleteTreeW(HKEY_CURRENT_USER, fixture.c_str()), "cleanup host fixture");
            return 0;
        }
        const bool unavailable = mode == L"--unavailable";
        const bool primary = mode == L"--test" || unavailable;
        std::wstring productName;
        HKEY preexisting = nullptr;
        if (primary)
        {
            Write(L"Software\\OpenTubeXRegressionContainer", L"Seed", L"host parent");
            Write(fixture, L"Original", L"host");
            Write(fixture, L"Deleted", L"keep on host");
            Write(fixture + L"\\HostChild", L"Value", L"host child");
            Check(RegOpenKeyExW(HKEY_CURRENT_USER, fixture.c_str(), 0, KEY_ALL_ACCESS, &preexisting), "open pre-injection key");
            productName = Read(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion", L"ProductName");
        }
        if (dll != L"none") Require(LoadLibraryW(dll.c_str()) != nullptr, "load Interposer");
        if (primary)
        {
            Require(Read(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion", L"ProductName") == productName,
                "system registry reads changed after loading Interposer");
            if (unavailable) {
                HKEY blocked = nullptr;
                Require(RegOpenKeyExW(HKEY_CURRENT_USER, fixture.c_str(), 0, KEY_READ, &blocked) == ERROR_ACCESS_DENIED,
                    "unavailable hive exposed host application data");
                Require(RegCreateKeyExW(HKEY_CURRENT_USER, (fixture + L"\\LocalChild").c_str(), 0, nullptr, 0,
                    KEY_ALL_ACCESS, nullptr, &blocked, nullptr) == ERROR_ACCESS_DENIED,
                    "unavailable hive allowed host application writes");
                wchar_t executable[32768];
                Require(GetModuleFileNameW(nullptr, executable, 32768) != 0, "get test executable");
                Child(executable, L"--host", dll, fixture);
                CheckHttps();
                Child(executable, L"--cleanup", dll, fixture);
                Child(executable, L"--remove-parent", dll, fixture);
                RegCloseKey(preexisting);
                std::cout << "Unavailable hive kept application state isolated and HTTPS working\n";
                return 0;
            }
            Require(RegSetValueExW(preexisting, L"Original", 0, REG_SZ, nullptr, 0) == ERROR_ACCESS_DENIED,
                "pre-injection handle changed host application data");
            RegCloseKey(preexisting);
            HKEY hidden = nullptr;
            LSTATUS hiddenStatus = RegOpenKeyExW(HKEY_CURRENT_USER, fixture.c_str(), 0, KEY_READ, &hidden);
            if (hidden) RegCloseKey(hidden);
            Require(hiddenStatus == ERROR_FILE_NOT_FOUND, "installed application registry data leaked into portable mode");
            Write(fixture, L"Deleted", L"portable only");
            Write(fixture, L"Original", L"portable");
            Write(fixture + L"\\LocalChild", L"Value", L"local child");
            HKEY key;
            Check(RegOpenKeyExW(HKEY_CURRENT_USER, fixture.c_str(), 0, KEY_READ | KEY_WRITE, &key), "open fixture");
            Check(RegDeleteValueW(key, L"Deleted"), "delete overlay value");
            RegCloseKey(key);
            CheckRegistrySemantics(fixture);
            CheckRegistryViews();
            wchar_t executable[32768];
            Require(GetModuleFileNameW(nullptr, executable, 32768) != 0, "get test executable");
            Write(L"Software\\OpenTubeXRegressionContainer\\OpenTubeX", L"Value", L"portable");
            Child(executable, L"--remove-parent", dll, fixture);
            Require(Read(HKEY_CURRENT_USER, L"Software\\OpenTubeXRegressionContainer\\OpenTubeX", L"Value") == L"portable",
                "portable key became unreadable after its host parent disappeared");
            Child(executable, L"--host", dll, fixture);
            Child(executable, L"--overlay", dll, fixture);
            Require(Read(HKEY_CURRENT_USER, fixture, L"FromChild") == L"shared", "child overlay write was lost");
            CheckHttps();
            Child(executable, L"--cleanup", dll, fixture);
        }
        else
        {
            Require(mode == L"--overlay", "unknown mode");
            Require(Read(HKEY_CURRENT_USER, fixture, L"Original") == L"portable", "portable value did not persist across processes");
            
            Require(Read(HKEY_CURRENT_USER, fixture + L"\\LocalChild", L"Value") == L"local child", "portable child missing");
            DWORD size = 0;
            Require(RegGetValueW(HKEY_CURRENT_USER, fixture.c_str(), L"Deleted", RRF_RT_REG_SZ, nullptr, nullptr, &size)
                == ERROR_FILE_NOT_FOUND, "deleted value reappeared in another process");
            Write(fixture, L"FromChild", L"shared");
        }
        std::wcout << L"Registry overlay checks passed: " << mode << L"\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
