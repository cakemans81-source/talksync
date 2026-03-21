export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-zinc-50 to-gray-100 flex items-center justify-center p-4">
      {children}
    </div>
  );
}
