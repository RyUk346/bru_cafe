import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

export default function LoginPage() {
  const [params] = useSearchParams();

  useEffect(() => {
    const token = params.get("token");

    if (token) {
      window.location.href = `/server-login?token=${encodeURIComponent(token)}`;
    }
  }, [params]);

  return (
    <div className="flex h-screen items-center justify-center bg-black text-white">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Screen Locked</h1>
        <p className="mt-2 text-white/60">
          Waiting for device authorization...
        </p>
      </div>
    </div>
  );
}
