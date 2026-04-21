export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-md space-y-6 p-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="mb-3 h-5 w-1/3 rounded bg-gray-200" />
          <div className="space-y-2">
            <div className="h-4 w-full rounded bg-gray-200" />
            <div className="h-4 w-4/5 rounded bg-gray-200" />
          </div>
        </div>
      ))}
    </div>
  );
}
