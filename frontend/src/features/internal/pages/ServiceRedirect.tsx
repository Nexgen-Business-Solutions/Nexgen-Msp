import { Navigate, useParams } from 'react-router-dom';

/** Historical links kept working: the Item now travels in the query, where any code fits. */
export default function ServiceRedirect() {
  const { name = '' } = useParams();

  return <Navigate replace to={`/msp/services/detail?item=${encodeURIComponent(name)}`} />;
}
