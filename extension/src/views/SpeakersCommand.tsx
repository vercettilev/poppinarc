"use client"
import { JUICE } from "~/theme/juice"
import { Autocomplete, Box, Chip, TextField, styled } from "@mui/material"
import { Fragment, useState } from "react"
import { useDebounceCallback } from "usehooks-ts"
import { useGetUsers } from "~/hooks/useGetUsers"
import { User } from "~/services/UserService"

interface SpeakersCommandProps {
  form: any // Assuming you're using React Hook Form or similar
}

const StyledAutocomplete = styled(Autocomplete<User, true>)({
  width: "100%",
  "& .MuiInputBase-root": {
    fontSize: 12,
    fontWeight: 500,
    backgroundColor: "#171717",
    border: "0.5px solid #323232",
    borderRadius: 8,
    color: "#FFFFFF",
    padding: "2px 8px",
    "& fieldset": {
      border: "none",
    },
  },
  "& .MuiChip-root": {
    backgroundColor: "#272727",
    color: "#FFFFFF",
    fontSize: "12px",
    height: "24px",
    "& .MuiChip-deleteIcon": {
      color: "#FFFFFF",
      width: "16px",
      height: "16px",
      "&:hover": {
        color: "#FF4D4D",
      },
    },
  },
  "& .MuiAutocomplete-popupIndicator": {
    color: "#FFFFFF",
    transform: "scale(0.7)",
    "&.MuiAutocomplete-popupIndicatorOpen": {
      transform: "rotate(180deg) scale(0.7)",
    },
  },
  "& .MuiAutocomplete-clearIndicator": {
    color: "#FFFFFF",
    padding: "2px",
    "& .MuiSvgIcon-root": {
      width: "18px",
      height: "18px",
    },
  },
  "& .MuiAutocomplete-endAdornment": {
    right: "8px",
    "& .MuiButtonBase-root": {
      padding: "2px",
    },
  },
})

const StyledTextField = styled(TextField)({
  "& .MuiInputBase-input": {
    color: "#FFFFFF",
  },
  "& .MuiInputLabel-root": {
    color: JUICE.text2,
  },
  "& .MuiInputLabel-root.Mui-focused": {
    color: JUICE.text2,
  },
})

const SpeakersCommand: React.FC<SpeakersCommandProps> = ({ form }) => {
  const [search, setSearch] = useState("")
  const [selectedSpeakers, setSelectedSpeakers] = useState<User[]>([])

  const onInputChange = useDebounceCallback((value: string) => {
    setSearch(value)
  }, 500)

  const { data: users = [], isLoading: isGetUsersLoading } = useGetUsers(search)

  return (
    <Fragment>
      <StyledAutocomplete
        multiple
        filterOptions={(x) => x}
        options={users}
        loading={isGetUsersLoading}
        value={selectedSpeakers}
        onChange={(_, newValue: User[]) => {
          setSelectedSpeakers(newValue)
          form.setValue("speakers", newValue)
        }}
        onInputChange={(_, value) => {
          onInputChange(value)
        }}
        getOptionLabel={(option: User) => option.username || ""}
        isOptionEqualToValue={(option: User, value: User) =>
          option.id === value.id
        }
        renderTags={(tagValue: User[], getTagProps) =>
          tagValue.map((option, index) => (
            <Chip
              label={option.username}
              {...getTagProps({ index })}
              key={option.id}
              size="small"
            />
          ))
        }
        renderInput={(params) => {
          const { InputProps, ...rest } = params
          return (
            <StyledTextField
              {...rest}
              placeholder="Search for speakers"
              InputProps={{
                ...InputProps,
                endAdornment: (
                  <Fragment>
                    {isGetUsersLoading ? (
                      <Box
                        component="span"
                        sx={{
                          color: JUICE.text2,
                          fontSize: "12px",
                          marginRight: "8px",
                        }}
                      >
                        Loading...
                      </Box>
                    ) : null}
                    {InputProps.endAdornment}
                  </Fragment>
                ),
              }}
            />
          )
        }}
        PaperComponent={(({ children }: { children: React.ReactNode }) => (
          <Box
            component="div"
            sx={{
              backgroundColor: "#171717",
              border: "1px solid #323232",
              borderRadius: "8px",
              marginTop: "3px",
              color: "#FFFFFF",
              "& .MuiAutocomplete-option": {
                fontSize: "12px",
                fontWeight: 400,
                padding: "6px 10px",
                "&:hover": {
                  backgroundColor: "#272727",
                },
                "&.Mui-focused": {
                  backgroundColor: "#272727",
                },
              },
            }}
          >
            {children}
          </Box>
        )) as any}
      />
    </Fragment>
  )
}

export default SpeakersCommand
