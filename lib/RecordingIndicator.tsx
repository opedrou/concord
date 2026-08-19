import { useIsRecording } from '@livekit/components-react';
import * as React from 'react';
import toast from 'react-hot-toast';
import { VideoIcon } from '@/lib/icons';

export function RecordingIndicator() {
  const isRecording = useIsRecording();
  const [wasRecording, setWasRecording] = React.useState(false);

  React.useEffect(() => {
    if (isRecording !== wasRecording) {
      setWasRecording(isRecording);
      if (isRecording) {
        // Posicao e tema base vem do AppToaster; aqui so o vermelho, que e
        // especifico deste aviso.
        toast('Esta reuniao esta sendo gravada', {
          duration: 6000,
          icon: <VideoIcon size={18} />,
          style: {
            background: 'var(--lk-danger3)',
            color: 'var(--lk-fg)',
          },
        });
      }
    }
  }, [isRecording]);

  return (
    <div
      style={{
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        boxShadow: isRecording ? 'var(--lk-danger3) 0px 0px 0px 3px inset' : 'none',
        pointerEvents: 'none',
      }}
    ></div>
  );
}
