import { useRouter } from "expo-router";
import { paths } from "../../navigation/pages";
import { SAMPLE_APPLICATIONS } from "../../sample-data";
import { EmptyScreen } from "../../screens/EmptyScreen";
import { Control } from "../../ui/Control";

/** Mes candidatures: the list to come (#684 onwards); meanwhile the sample Application, to reach its page. */
export default function Applications() {
  const router = useRouter();
  return (
    <EmptyScreen>
      {SAMPLE_APPLICATIONS.map((application) => (
        <Control key={application.id} label={application.title} look="secondary" onPress={() => router.navigate(paths.application(application.id))} />
      ))}
    </EmptyScreen>
  );
}
