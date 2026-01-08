"use client";

export default function InterceptConsoleError() {
  // Disabled: this component was causing a setState/useEffect loop
  // leading to "Maximum update depth exceeded".
  return null;
}
