#include <node_api.h>
#include <windows.h>
#include <shobjidl_core.h>
#include <winrt/Windows.ApplicationModel.DataTransfer.h>
#include <winrt/Windows.Foundation.h>
#include <cstring>
#include <map>
#include <string>

using namespace winrt;
using namespace Windows::ApplicationModel::DataTransfer;

// Electron calls this module on its Windows UI thread. Keep the event handler
// alive while the picker requests data, and revoke it when the window closes.
struct ShareRequest {
    DataTransferManager manager{nullptr};
    DataTransferManager::DataRequested_revoker requested;
};
static std::map<HWND, ShareRequest> requests;

static HWND ReadWindow(napi_env env, napi_value value) {
    bool isBuffer = false;
    napi_is_buffer(env, value, &isBuffer);
    void* data = nullptr;
    size_t size = 0;
    if (!isBuffer || napi_get_buffer_info(env, value, &data, &size) != napi_ok || size != sizeof(HWND)) {
        throw hresult_invalid_argument(L"Invalid native window handle");
    }
    HWND window;
    std::memcpy(&window, data, sizeof(window));
    return window;
}

static napi_value Share(napi_env env, napi_callback_info info) {
    try {
        size_t count = 2;
        napi_value args[2];
        napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
        if (count != 2) throw hresult_invalid_argument();
        HWND window = ReadWindow(env, args[0]);
        if (!IsWindow(window)) throw hresult_invalid_argument(L"The sharing window is closed");
        size_t length = 0;
        if (napi_get_value_string_utf16(env, args[1], nullptr, 0, &length) != napi_ok || length > 8192) {
            throw hresult_invalid_argument(L"Invalid share URL");
        }
        std::u16string url(length + 1, u'\0');
        napi_get_value_string_utf16(env, args[1], url.data(), url.size(), &length);
        url.resize(length);
        Windows::Foundation::Uri uri(hstring(reinterpret_cast<const wchar_t*>(url.data()), static_cast<uint32_t>(length)));
        if (uri.SchemeName() != L"https" && uri.SchemeName() != L"http") throw hresult_invalid_argument();
        auto interop = get_activation_factory<DataTransferManager, IDataTransferManagerInterop>();
        ShareRequest request;
        check_hresult(interop->GetForWindow(window, guid_of<DataTransferManager>(), put_abi(request.manager)));
        request.requested = request.manager.DataRequested(auto_revoke, [uri](auto const&, DataRequestedEventArgs const& args) {
            auto data = args.Request().Data();
            data.Properties().Title(L"OpenTubeX");
            data.SetWebLink(uri);
            data.SetText(uri.AbsoluteUri());
        });
        requests.insert_or_assign(window, std::move(request));
        check_hresult(interop->ShowShareUIForWindow(window));
    } catch (hresult_error const& error) {
        napi_throw_error(env, nullptr, to_string(error.message()).c_str());
    } catch (std::exception const& error) {
        napi_throw_error(env, nullptr, error.what());
    }
    return nullptr;
}

static napi_value Close(napi_env env, napi_callback_info info) {
    try {
        size_t count = 1;
        napi_value arg;
        napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr);
        if (count != 1) throw hresult_invalid_argument();
        requests.erase(ReadWindow(env, arg));
    } catch (hresult_error const& error) {
        napi_throw_error(env, nullptr, to_string(error.message()).c_str());
    }
    return nullptr;
}

NAPI_MODULE_INIT() {
    const napi_property_descriptor methods[] = {
        {"share", nullptr, Share, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"close", nullptr, Close, nullptr, nullptr, nullptr, napi_default, nullptr}
    };
    napi_define_properties(env, exports, 2, methods);
    napi_add_env_cleanup_hook(env, [](void*) { requests.clear(); }, nullptr);
    return exports;
}
