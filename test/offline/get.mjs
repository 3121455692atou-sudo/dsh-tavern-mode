export default function get(value, path, fallback) {
  const result = (Array.isArray(path) ? path : String(path).replace(/\[(\d+)\]/g, '.$1').split('.')).reduce((node, key) => node?.[key], value);
  return result === undefined ? fallback : result;
}
