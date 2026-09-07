#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <winhttp.h>
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
            return 0;
        }
        if (mode == L"--cleanup")
        {
            Check(RegDeleteTreeW(HKEY_CURRENT_USER, fixture.c_str()), "cleanup host fixture");
            return 0;
        }
        const bool primary = mode == L"--test";
        std::wstring productName;
        if (primary)
        {
            Write(fixture, L"Original", L"host");
            Write(fixture, L"Deleted", L"keep on host");
            Write(fixture + L"\\HostChild", L"Value", L"host child");
            productName = Read(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion", L"ProductName");
        }
        if (dll != L"none") Require(LoadLibraryW(dll.c_str()) != nullptr, "load Interposer");
        if (primary)
        {
            Require(Read(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion", L"ProductName") == productName,
                "system registry reads changed after loading Interposer");
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
            wchar_t executable[32768];
            Require(GetModuleFileNameW(nullptr, executable, 32768) != 0, "get test executable");
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
