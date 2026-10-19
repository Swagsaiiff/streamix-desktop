using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace Streamix
{
    static class VideoHost
    {
        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        static extern ushort RegisterClassEx([In] ref WNDCLASSEX lpwcx);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        static extern IntPtr CreateWindowEx(
            uint dwExStyle, string lpClassName, string lpWindowName,
            uint dwStyle, int x, int y, int nWidth, int nHeight,
            IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool DestroyWindow(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        static extern IntPtr DefWindowProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        static extern IntPtr GetDesktopWindow();

        [DllImport("user32.dll")]
        static extern bool GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll")]
        static extern bool TranslateMessage([In] ref MSG lpMsg);

        [DllImport("user32.dll")]
        static extern IntPtr DispatchMessage([In] ref MSG lpmsg);

        [DllImport("user32.dll")]
        static extern void PostQuitMessage(int nExitCode);

        [DllImport("user32.dll")]
        static extern IntPtr BeginPaint(IntPtr hWnd, out PAINTSTRUCT lpPaint);

        [DllImport("user32.dll")]
        static extern bool EndPaint(IntPtr hWnd, [In] ref PAINTSTRUCT lpPaint);

        [DllImport("gdi32.dll")]
        static extern IntPtr GetStockObject(int fnObject);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
        static extern IntPtr GetModuleHandle(string lpModuleName);

        delegate IntPtr WndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        struct WNDCLASSEX
        {
            public uint cbSize;
            public uint style;
            public WndProc lpfnWndProc;
            public int cbClsExtra;
            public int cbWndExtra;
            public IntPtr hInstance;
            public IntPtr hIcon;
            public IntPtr hCursor;
            public IntPtr hbrBackground;
            public string lpszMenuName;
            public string lpszClassName;
            public IntPtr hIconSm;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public int pt_x;
            public int pt_y;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct PAINTSTRUCT
        {
            public IntPtr hdc;
            public bool fErase;
            public RECT rcPaint;
            public bool fRestore;
            public bool fIncUpdate;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
            public byte[] rgbReserved;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct RECT
        {
            public int left, top, right, bottom;
        }

        const uint WS_CHILD = 0x40000000;
        const uint WS_VISIBLE = 0x10000000;
        const uint WS_CLIPCHILDREN = 0x02000000;
        const uint WS_CLIPSIBLINGS = 0x04000000;

        const uint SWP_NOZORDER = 0x0004;
        const uint SWP_NOACTIVATE = 0x0010;
        const uint SWP_SHOWWINDOW = 0x0040;
        const uint SWP_HIDEWINDOW = 0x0080;

        const int SW_HIDE = 0;
        const int SW_SHOW = 5;
        const int BLACK_BRUSH = 4;

        const uint WM_ERASEBKGND = 0x0014;
        const uint WM_PAINT = 0x000F;
        const uint WM_DESTROY = 0x0002;

        static WndProc wndProcDelegate;
        static IntPtr currentHwnd = IntPtr.Zero;
        static uint uiThreadId = 0;

        [DllImport("kernel32.dll")]
        static extern uint GetCurrentThreadId();

        [DllImport("user32.dll")]
        static extern bool PostThreadMessage(uint idThread, uint Msg, IntPtr wParam, IntPtr lParam);

        const uint WM_USER = 0x0400;
        const uint WM_USER_CREATE = WM_USER + 1;
        const uint WM_USER_BOUNDS = WM_USER + 2;
        const uint WM_USER_SHOW = WM_USER + 3;
        const uint WM_USER_HIDE = WM_USER + 4;
        const uint WM_USER_DESTROY = WM_USER + 5;

        class CreateParams
        {
            public IntPtr Parent;
            public int X, Y, W, H;
            public ManualResetEvent Ready = new ManualResetEvent(false);
            public IntPtr Result = IntPtr.Zero;
        }

        static IntPtr CustomWndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
        {
            switch (msg)
            {
                case WM_ERASEBKGND:
                    return new IntPtr(1); // handled
                case WM_PAINT:
                    PAINTSTRUCT ps;
                    IntPtr hdc = BeginPaint(hWnd, out ps);
                    EndPaint(hWnd, ref ps);
                    return IntPtr.Zero;
                case WM_DESTROY:
                    return IntPtr.Zero;
                default:
                    return DefWindowProc(hWnd, msg, wParam, lParam);
            }
        }

        [STAThread]
        static void Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;

            IntPtr hInst = GetModuleHandle(null);
            wndProcDelegate = CustomWndProc;

            WNDCLASSEX wc = new WNDCLASSEX();
            wc.cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX));
            wc.style = 0x0002 | 0x0001; // CS_HREDRAW | CS_VREDRAW
            wc.lpfnWndProc = wndProcDelegate;
            wc.cbClsExtra = 0;
            wc.cbWndExtra = 0;
            wc.hInstance = hInst;
            wc.hIcon = IntPtr.Zero;
            wc.hCursor = IntPtr.Zero;
            wc.hbrBackground = GetStockObject(BLACK_BRUSH);
            wc.lpszMenuName = null;
            wc.lpszClassName = "StreamixVideoSurfaceClass";
            wc.hIconSm = IntPtr.Zero;

            RegisterClassEx(ref wc);

            ManualResetEvent threadReady = new ManualResetEvent(false);
            CreateParams pendingCreate = null;

            Thread windowThread = new Thread(() =>
            {
                uiThreadId = GetCurrentThreadId();
                threadReady.Set();

                MSG msg;
                while (GetMessage(out msg, IntPtr.Zero, 0, 0))
                {
                    if (msg.message == WM_USER_CREATE && pendingCreate != null)
                    {
                        if (currentHwnd != IntPtr.Zero)
                        {
                            DestroyWindow(currentHwnd);
                            currentHwnd = IntPtr.Zero;
                        }
                        IntPtr parent = pendingCreate.Parent;
                        uint style = WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS;
                        if (parent != IntPtr.Zero)
                        {
                            style |= WS_CHILD;
                        }
                        else
                        {
                            style |= 0x80000000; // WS_POPUP
                        }

                        currentHwnd = CreateWindowEx(
                            0,
                            "StreamixVideoSurfaceClass",
                            "StreamixVideoSurface",
                            style,
                            pendingCreate.X, pendingCreate.Y, pendingCreate.W, pendingCreate.H,
                            parent,
                            IntPtr.Zero,
                            hInst,
                            IntPtr.Zero
                        );
                        pendingCreate.Result = currentHwnd;
                        pendingCreate.Ready.Set();
                    }
                    else if (msg.message == WM_USER_DESTROY)
                    {
                        if (currentHwnd != IntPtr.Zero)
                        {
                            DestroyWindow(currentHwnd);
                            currentHwnd = IntPtr.Zero;
                        }
                    }
                    else
                    {
                        TranslateMessage(ref msg);
                        DispatchMessage(ref msg);
                    }
                }
            });

            windowThread.SetApartmentState(ApartmentState.STA);
            windowThread.IsBackground = true;
            windowThread.Start();
            threadReady.WaitOne();

            string line;
            while ((line = Console.ReadLine()) != null)
            {
                try
                {
                    line = line.Trim();
                    if (string.IsNullOrEmpty(line)) continue;
                    string[] parts = line.Split(' ');
                    string cmd = parts[0].ToUpperInvariant();

                    if (cmd == "CREATE" && parts.Length >= 6)
                    {
                        long parentVal = long.Parse(parts[1]);
                        int x = int.Parse(parts[2]);
                        int y = int.Parse(parts[3]);
                        int w = int.Parse(parts[4]);
                        int h = int.Parse(parts[5]);

                        pendingCreate = new CreateParams
                        {
                            Parent = new IntPtr(parentVal),
                            X = x,
                            Y = y,
                            W = w,
                            H = h
                        };
                        PostThreadMessage(uiThreadId, WM_USER_CREATE, IntPtr.Zero, IntPtr.Zero);
                        pendingCreate.Ready.WaitOne(3000);

                        Console.WriteLine("{\"ok\":true,\"hwnd\":" + pendingCreate.Result.ToInt64() + "}");
                    }
                    else if (cmd == "BOUNDS" && parts.Length >= 5)
                    {
                        int x = int.Parse(parts[1]);
                        int y = int.Parse(parts[2]);
                        int w = int.Parse(parts[3]);
                        int h = int.Parse(parts[4]);

                        if (currentHwnd != IntPtr.Zero)
                        {
                            SetWindowPos(currentHwnd, IntPtr.Zero, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
                        }
                        Console.WriteLine("{\"ok\":true}");
                    }
                    else if (cmd == "SHOW")
                    {
                        if (currentHwnd != IntPtr.Zero)
                        {
                            ShowWindow(currentHwnd, SW_SHOW);
                        }
                        Console.WriteLine("{\"ok\":true}");
                    }
                    else if (cmd == "HIDE")
                    {
                        if (currentHwnd != IntPtr.Zero)
                        {
                            ShowWindow(currentHwnd, SW_HIDE);
                        }
                        Console.WriteLine("{\"ok\":true}");
                    }
                    else if (cmd == "DESTROY")
                    {
                        PostThreadMessage(uiThreadId, WM_USER_DESTROY, IntPtr.Zero, IntPtr.Zero);
                        currentHwnd = IntPtr.Zero;
                        Console.WriteLine("{\"ok\":true}");
                    }
                    else if (cmd == "QUIT")
                    {
                        break;
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine("{\"ok\":false,\"error\":\"" + ex.Message.Replace("\"", "'") + "\"}");
                }
            }

            if (currentHwnd != IntPtr.Zero)
            {
                PostThreadMessage(uiThreadId, WM_USER_DESTROY, IntPtr.Zero, IntPtr.Zero);
            }
        }
    }
}
