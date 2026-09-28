import AppLayout from './AppLayout';

// KGT staff pages (/admin/*): AppLayout with the staff session, sign-in and navigation.
export default function OperatorLayout(props) {
  return <AppLayout audience="staff" {...props} />;
}
